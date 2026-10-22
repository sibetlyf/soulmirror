// meeting-bridge.exe — Windows 音频/语音小工具，供 dsh-meeting-agent 插件调用。
// 编译：csc /target:exe /out:mbridge.exe meeting-bridge.cs /r:System.Speech.dll
// 命令：
//   devices                                   列出渲染/采集端点
//   capture --out <wav> --seconds <n> [--device <id|name>]   环回采集，输出 16k 单声道 PCM16
//   play    --file <wav> [--device <id|name>]                播放 WAV 到指定渲染端点
//   tts     --text <txt> --out <wav> [--voice <name>] [--rate <n>]  离线语音合成（SAPI）
//   voices                                    列出已安装 TTS 音色
//   tone    --out <wav> [--seconds <n>] [--freq <hz>]         生成测试音（用于自检）
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Speech.AudioFormat;
using System.Speech.Synthesis;
using System.Text;
using System.Threading;

namespace MeetingBridge
{
    static class Program
    {
        static int Main(string[] args)
        {
            try
            {
                if (args.Length == 0) { Usage(); return 2; }
                string cmd = args[0].ToLowerInvariant();
                var opt = Parse(args);
                switch (cmd)
                {
                    case "devices": CmdDevices(); return 0;
                    case "capture": CmdCapture(opt); return 0;
                    case "capture-process": CmdCaptureProcess(opt); return 0;
                    case "mic-usage": CmdMicUsage(opt); return 0;
                    case "set-default": CmdSetDefault(opt); return 0;
                    case "stream-play": CmdStreamPlay(opt); return 0;
                    case "capture-stream": CmdCaptureStream(opt); return 0;
                    case "play": CmdPlay(opt); return 0;
                    case "tts": CmdTts(opt); return 0;
                    case "voices": CmdVoices(); return 0;
                    case "tone": CmdTone(opt); return 0;
                    case "rms": CmdRms(opt); return 0;
                    case "meters": CmdMeters(); return 0;
                    default: Usage(); return 2;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("ERR " + ex.GetType().Name + ": " + ex.Message);
                return 1;
            }
        }

        static void Usage()
        {
            Console.Error.WriteLine("usage: mbridge <devices|capture|play|tts|voices|tone> [options]");
        }

        static Dictionary<string, string> Parse(string[] args)
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 1; i < args.Length; i++)
            {
                string a = args[i];
                if (a.StartsWith("--"))
                {
                    string k = a.Substring(2);
                    string v = (i + 1 < args.Length && !args[i + 1].StartsWith("--")) ? args[++i] : "1";
                    d[k] = v;
                }
            }
            return d;
        }

        static string Get(Dictionary<string, string> o, string k, string def)
        {
            string v;
            return o.TryGetValue(k, out v) ? v : def;
        }

        static int GetInt(Dictionary<string, string> o, string k, int def)
        {
            int v;
            return int.TryParse(Get(o, k, ""), out v) ? v : def;
        }

        // ---------------- default endpoint (IPolicyConfig) ----------------

        static void CmdSetDefault(Dictionary<string, string> o)
        {
            string flow = Get(o, "flow", "capture").ToLowerInvariant();
            string sel = Get(o, "device", null);
            if (string.IsNullOrEmpty(sel)) throw new Exception("--device required");
            var dev = FindDevice(flow == "render" ? 0 : 1, false, sel);
            string id; dev.GetId(out id);
            var pc = (IPolicyConfig)new PolicyConfigClient();
            int roles = 0;
            for (int role = 0; role <= 2; role++)
            {
                int hr = pc.SetDefaultEndpoint(id, role);
                if (hr == 0) roles++;
            }
            Console.WriteLine("OK default " + flow + " = " + FriendlyName(dev) + " roles=" + roles);
        }

        [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
        class PolicyConfigClient { }

        [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IPolicyConfig
        {
            int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceName, out IntPtr format);
            int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceName, int bDefault, out IntPtr format);
            int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceName);
            int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceName, IntPtr endpointFormat, IntPtr mixFormat);
            int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceName, int bDefault, out long period, out long minPeriod);
            int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceName, ref long period);
            int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceName, out int mode);
            int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceName, ref int mode);
            int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string deviceName, ref PROPERTYKEY key, out PROPVARIANT value);
            int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string deviceName, ref PROPERTYKEY key, ref PROPVARIANT value);
            int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceName, int role);
            int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string deviceName, int visible);
        }
        // ---------------- mic usage: 谁在占用麦克风 / 会议是否静音 ----------------

        static void CmdMicUsage(Dictionary<string, string> o)
        {
            var en = CreateEnumerator();
            IMMDeviceCollection col;
            en.EnumAudioEndpoints(1, 1, out col);
            int n; col.GetCount(out n);
            Console.OutputEncoding = Encoding.UTF8;
            for (int i = 0; i < n; i++)
            {
                IMMDevice dev; col.Item(i, out dev);
                string devName = FriendlyName(dev);
                object oMgr;
                try { dev.Activate(typeof(IAudioSessionManager2).GUID, 0x17, IntPtr.Zero, out oMgr); }
                catch { continue; }
                var mgr = (IAudioSessionManager2)oMgr;
                IAudioSessionEnumerator ses;
                int hr = mgr.GetSessionEnumerator(out ses);
                if (hr != 0) { Marshal.ReleaseComObject(mgr); continue; }
                int cnt; ses.GetCount(out cnt);
                for (int j = 0; j < cnt; j++)
                {
                    IAudioSessionControl ctl;
                    if (ses.GetSession(j, out ctl) != 0) continue;
                    string procName = "";
                    int pid = 0, state = 0;
                    try
                    {
                        var ctl2 = (IAudioSessionControl2)ctl;
                        ctl2.GetProcessId(out pid);
                        ctl2.GetState(out state);
                        if (pid > 0)
                        {
                            try { procName = System.Diagnostics.Process.GetProcessById(pid).ProcessName; } catch { }
                        }
                    }
                    catch { }
                    if (!string.IsNullOrEmpty(procName) || pid > 0)
                        Console.WriteLine(devName + "\t" + pid + "\t" + procName + "\t" + state);
                    Marshal.ReleaseComObject(ctl);
                }
                Marshal.ReleaseComObject(ses);
                Marshal.ReleaseComObject(mgr);
            }
            Marshal.ReleaseComObject(col);
        }
        // ---------------- per-process loopback (只采某个进程的声音) ----------------

        static int ResolvePid(string nameOrPid)
        {
            int pid;
            if (int.TryParse(nameOrPid, out pid)) return pid;
            string name = nameOrPid.ToLowerInvariant().Replace(".exe", "");
            var procs = System.Diagnostics.Process.GetProcessesByName(name);
            if (procs.Length == 0) throw new Exception("process not found: " + nameOrPid);
            var best = procs[0];
            foreach (var pr in procs)
            {
                if (pr.MainWindowHandle != IntPtr.Zero) { best = pr; break; }
                if (pr.WorkingSet64 > best.WorkingSet64) best = pr;
            }
            return best.Id;
        }

        static WAVEFORMATEX BuildFormat(int rate, int ch, bool f32)
        {
            var f = new WAVEFORMATEX();
            f.wFormatTag = (ushort)(f32 ? 3 : 1);
            f.nChannels = (ushort)ch;
            f.nSamplesPerSec = (uint)rate;
            f.wBitsPerSample = (ushort)(f32 ? 32 : 16);
            f.nBlockAlign = (ushort)(ch * f.wBitsPerSample / 8);
            f.nAvgBytesPerSec = (uint)(rate * f.nBlockAlign);
            f.cbSize = 0;
            return f;
        }

        [DllImport("ole32.dll")] static extern int CoInitializeEx(IntPtr pvReserved, int dwCoInit);
        [DllImport("ole32.dll")] static extern void CoUninitialize();

        static IAudioClient CreateProcessLoopbackClient(int pid)
        {
            IAudioClient result = null;
            Exception failure = null;
            var thread = new Thread(delegate()
            {
                int coHr = CoInitializeEx(IntPtr.Zero, 2); // STA：ActivateAudioInterfaceAsync 需要 STA
                try
                {
                    var ap = new AUDIOCLIENT_ACTIVATION_PARAMS
                    {
                        ActivationType = 1,
                        ProcessLoopbackParams = new AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS { TargetProcessId = pid, ProcessLoopbackMode = 1 }
                    };
                    int apSize = Marshal.SizeOf(typeof(AUDIOCLIENT_ACTIVATION_PARAMS));
                    IntPtr blob = Marshal.AllocHGlobal(apSize);
                    Marshal.StructureToPtr(ap, blob, false);

                    var pv = new PROPVARIANT_BLOB();
                    pv.vt = 65; // VT_BLOB
                    pv.cbSize = (uint)apSize;
                    pv.pBlobData = blob;
                    IntPtr pvPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(PROPVARIANT_BLOB)));
                    Marshal.StructureToPtr(pv, pvPtr, false);

                    var handler = new ActivationHandler();
                    Guid iid = typeof(IAudioClient).GUID;
                    IActivateAudioInterfaceAsyncOperation op;
                    IntPtr handlerPtr;
                    try { handlerPtr = Marshal.GetComInterfaceForObject(handler, typeof(IActivateAudioInterfaceCompletionHandler)); }
                    catch (Exception ce) { throw new Exception("GetComInterfaceForObject failed: " + ce.Message); }
                    int callHr = ActivateAudioInterfaceAsync(@"VAD\Process_Loopback", ref iid, pvPtr, handlerPtr, out op);
                    if (callHr < 0) throw new Exception("ActivateAudioInterfaceAsync hr=0x" + callHr.ToString("X8") + " co=0x" + coHr.ToString("X8") + " apt=" + Thread.CurrentThread.GetApartmentState().ToString());
                    if (!handler.Done.Wait(8000)) throw new Exception("process loopback activation timeout");
                    if (handler.Hr < 0) throw new Exception("process loopback activation hr=0x" + handler.Hr.ToString("X8"));
                    result = (IAudioClient)handler.Client;
                }
                catch (Exception e) { failure = e; }
                finally { if (coHr >= 0) CoUninitialize(); }
            });
            thread.SetApartmentState(ApartmentState.STA);
            thread.IsBackground = true;
            thread.Start();
            thread.Join(12000);
            if (failure != null) throw failure;
            if (result == null) throw new Exception("process loopback activation returned nothing");
            return result;
        }
        static void CmdCaptureProcess(Dictionary<string, string> o)
        {
            string outFile = Get(o, "out", null);
            if (string.IsNullOrEmpty(outFile)) throw new Exception("--out required");
            int seconds = GetInt(o, "seconds", 5);
            string proc = Get(o, "process", "wemeetapp");
            int pid = ResolvePid(proc);
            double gain = 1.0;
            double.TryParse(Get(o, "gain", "1"), NumberStyles.Float, CultureInfo.InvariantCulture, out gain);
            if (gain <= 0) gain = 1.0;

            var client = CreateProcessLoopbackClient(pid);
            var candidates = new int[][] {
                new int[] { 48000, 2, 1 },
                new int[] { 48000, 2, 0 },
                new int[] { 44100, 2, 0 },
                new int[] { 44100, 2, 1 },
                new int[] { 16000, 2, 0 },
                new int[] { 16000, 1, 0 },
            };
            int hr = -1;
            WAVEFORMATEX fmt = BuildFormat(48000, 2, false);
            for (int i = 0; i < candidates.Length; i++)
            {
                var c = candidates[i];
                fmt = BuildFormat(c[0], c[1], c[2] == 1);
                IntPtr fmtPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WAVEFORMATEX)));
                Marshal.StructureToPtr(fmt, fmtPtr, false);
                hr = client.Initialize(0, 0x00020000, 3000000L, 0L, fmtPtr, IntPtr.Zero);
                Marshal.FreeHGlobal(fmtPtr);
                if (hr == 0) break;
            }
            if (hr != 0) throw new Exception("process loopback Initialize hr=0x" + hr.ToString("X8"));

            int bufFrames; client.GetBufferSize(out bufFrames);
            object oCap;
            client.GetService(typeof(IAudioCaptureClient).GUID, out oCap);
            var cap = (IAudioCaptureClient)oCap;

            bool isFloat = fmt.wBitsPerSample == 32;
            int srcRate = (int)fmt.nSamplesPerSec;
            int srcCh = fmt.nChannels;
            var pcm = new List<short>();

            client.Start();
            var sw = System.Diagnostics.Stopwatch.StartNew();
            while (sw.Elapsed.TotalSeconds < seconds)
            {
                int packet; cap.GetNextPacketSize(out packet);
                if (packet == 0) { Thread.Sleep(5); continue; }
                IntPtr data; int nFrames; int flags; long pos; long qpc;
                cap.GetBuffer(out data, out nFrames, out flags, out pos, out qpc);
                if (nFrames > 0 && flags == 0)
                {
                    int bytes = nFrames * srcCh * (fmt.wBitsPerSample / 8);
                    byte[] buf = new byte[bytes];
                    Marshal.Copy(data, buf, 0, bytes);
                    AppendMono(buf, nFrames, srcCh, isFloat, pcm, gain);
                }
                cap.ReleaseBuffer(nFrames);
            }
            client.Stop();

            var mono = Resample(pcm, srcRate, 16000);
            WriteWav16(outFile, mono, 16000);
            Console.WriteLine("OK pid=" + pid + " frames=" + mono.Length + " srcRate=" + srcRate + " ch=" + srcCh + " out=" + outFile);
        }
        // ---------------- devices ----------------

        static void CmdDevices()
        {
            var en = CreateEnumerator();
            for (int flow = 0; flow <= 1; flow++)
            {
                IMMDeviceCollection col;
                en.EnumAudioEndpoints(flow, 1, out col); // 1 = ACTIVE
                int n; col.GetCount(out n);
                for (int i = 0; i < n; i++)
                {
                    IMMDevice dev; col.Item(i, out dev);
                    string id; dev.GetId(out id);
                    string name = FriendlyName(dev);
                    Console.OutputEncoding = Encoding.UTF8;
                    Console.WriteLine((flow == 0 ? "RENDER" : "CAPTURE") + "\t" + i + "\t" + name + "\t" + id);
                }
                Marshal.ReleaseComObject(col);
            }
        }

        static IMMDeviceEnumerator CreateEnumerator()
        {
            return (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        }

        static string FriendlyName(IMMDevice dev)
        {
            IPropertyStore ps;
            dev.OpenPropertyStore(0, out ps);
            var key = new PROPERTYKEY();
            key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
            key.pid = 14;
            PROPVARIANT pv;
            ps.GetValue(ref key, out pv);
            string name = "";
            if (pv.pwszVal != IntPtr.Zero) name = Marshal.PtrToStringUni(pv.pwszVal);
            Marshal.ReleaseComObject(ps);
            return name ?? "";
        }

        static int DeviceState(IMMDevice dev) { int s; dev.GetState(out s); return s; }

        static IMMDevice FindDevice(int flow, bool isDefault, string selector)
        {
            var en = CreateEnumerator();
            if (isDefault)
            {
                IMMDevice d;
                en.GetDefaultAudioEndpoint(flow, 0, out d);
                return d;
            }
            IMMDeviceCollection col;
            en.EnumAudioEndpoints(flow, 1, out col);
            int n; col.GetCount(out n);
            IMMDevice best = null;
            for (int i = 0; i < n; i++)
            {
                IMMDevice dev; col.Item(i, out dev);
                string id; dev.GetId(out id);
                string name = FriendlyName(dev);
                bool match = id == selector
                    || name == selector
                    || (!string.IsNullOrEmpty(selector) && name.IndexOf(selector, StringComparison.OrdinalIgnoreCase) >= 0);
                if (match) { best = dev; break; }
                if (i == n - 1 && best == null)
                    throw new Exception("device not found: " + selector);
            }
            if (best == null) throw new Exception("device not found: " + selector);
            return best;
        }

        // ---------------- capture (WASAPI loopback) ----------------

        static void CmdCapture(Dictionary<string, string> o)
        {
            string outFile = Get(o, "out", null);
            if (string.IsNullOrEmpty(outFile)) throw new Exception("--out required");
            int seconds = GetInt(o, "seconds", 5);
            string sel = Get(o, "device", null);
            string mode = Get(o, "mode", "loopback").ToLowerInvariant();
            double gain = 1.0;
            double.TryParse(Get(o, "gain", "1"), NumberStyles.Float, CultureInfo.InvariantCulture, out gain);
            if (gain <= 0) gain = 1.0;
            bool loopback = mode != "device";
            var dev = loopback ? FindDevice(0, string.IsNullOrEmpty(sel), sel)
                               : FindDevice(1, string.IsNullOrEmpty(sel), sel);

            object oClient;
            dev.Activate(typeof(IAudioClient).GUID, 0x17, IntPtr.Zero, out oClient);
            var client = (IAudioClient)oClient;

            IntPtr fmtPtr;
            client.GetMixFormat(out fmtPtr);
            var fmt = (WAVEFORMATEX)Marshal.PtrToStructure(fmtPtr, typeof(WAVEFORMATEX));

            int hr = client.Initialize(0, loopback ? 0x00020000 : 0, 10000000L, 0L, fmtPtr, IntPtr.Zero);
            if (hr != 0) throw new Exception("IAudioClient.Initialize hr=0x" + hr.ToString("X8"));

            int frames; client.GetBufferSize(out frames);
            object oCap;
            client.GetService(typeof(IAudioCaptureClient).GUID, out oCap);
            var cap = (IAudioCaptureClient)oCap;

            var pcm = new List<short>();
            int srcRate = (int)fmt.nSamplesPerSec;
            int srcCh = fmt.nChannels;
            bool isFloat = fmt.wBitsPerSample == 32;

            client.Start();
            var sw = System.Diagnostics.Stopwatch.StartNew();
            while (sw.Elapsed.TotalSeconds < seconds)
            {
                int packet; int hrr = cap.GetNextPacketSize(out packet);
                if (hrr != 0) throw new Exception("GetNextPacketSize hr=0x" + hrr.ToString("X8"));
                if (packet == 0) { Thread.Sleep(5); continue; }

                IntPtr data; int nFrames; int flags; long pos; long qpc;
                cap.GetBuffer(out data, out nFrames, out flags, out pos, out qpc);
                if (nFrames > 0 && flags == 0)
                {
                    int bytes = nFrames * srcCh * (fmt.wBitsPerSample / 8);
                    byte[] buf = new byte[bytes];
                    Marshal.Copy(data, buf, 0, bytes);
                    AppendMono(buf, nFrames, srcCh, isFloat, pcm, gain);
                }
                cap.ReleaseBuffer(nFrames);
            }
            client.Stop();

            var mono16k = Resample(pcm, srcRate, 16000);
            WriteWav16(outFile, mono16k, 16000);
            Console.WriteLine("OK frames=" + mono16k.Length + " rate=16000 out=" + outFile + " srcRate=" + srcRate + " ch=" + srcCh);
        }

        static void AppendMono(byte[] buf, int frames, int channels, bool isFloat, List<short> outp, double gain)
        {
            if (isFloat)
            {
                for (int f = 0; f < frames; f++)
                {
                    float sum = 0f;
                    for (int c = 0; c < channels; c++)
                        sum += BitConverter.ToSingle(buf, (f * channels + c) * 4);
                    float v = sum / channels;
                    if (v > 1f) v = 1f; if (v < -1f) v = -1f;
                    outp.Add((short)(v * 32767f));
                }
            }
            else if (channels > 1)
            {
                for (int f = 0; f < frames; f++)
                {
                    int sum = 0;
                    for (int c = 0; c < channels; c++)
                        sum += BitConverter.ToInt16(buf, (f * channels + c) * 2);
                    outp.Add((short)(sum / channels));
                }
            }
            else
            {
                for (int f = 0; f < frames; f++) outp.Add(BitConverter.ToInt16(buf, f * 2));
            }
        }

        static short[] Resample(List<short> src, int from, int to)
        {
            if (from == to) return src.ToArray();
            int n = (int)((long)src.Count * to / from);
            var dst = new short[n];
            double step = (double)from / to;
            for (int i = 0; i < n; i++)
            {
                double p = i * step;
                int i0 = (int)p; int i1 = Math.Min(i0 + 1, src.Count - 1);
                double frac = p - i0;
                double v = src[i0] * (1 - frac) + src[i1] * frac;
                dst[i] = (short)Math.Max(-32768, Math.Min(32767, v));
            }
            return dst;
        }

        static void WriteWav16(string path, short[] data, int rate)
        {
            using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write))
            using (var w = new BinaryWriter(fs))
            {
                int byteCount = data.Length * 2;
                w.Write(Encoding.ASCII.GetBytes("RIFF"));
                w.Write(36 + byteCount);
                w.Write(Encoding.ASCII.GetBytes("WAVE"));
                w.Write(Encoding.ASCII.GetBytes("fmt "));
                w.Write(16);
                w.Write((short)1);
                w.Write((short)1);
                w.Write(rate);
                w.Write(rate * 2);
                w.Write((short)2);
                w.Write((short)16);
                w.Write(Encoding.ASCII.GetBytes("data"));
                w.Write(byteCount);
                foreach (short s in data) w.Write(s);
            }
        }

        static short[] ReadWav16(string path, out int rate)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read))
            using (var r = new BinaryReader(fs))
            {
                string riff = new string(r.ReadChars(4));
                if (riff != "RIFF") throw new Exception("not a RIFF file");
                r.ReadInt32();
                new string(r.ReadChars(4));
                rate = 44100;
                short channels = 1, bits = 16;
                var data = new List<short>();
                while (fs.Position + 8 <= fs.Length)
                {
                    string id = new string(r.ReadChars(4));
                    int size = r.ReadInt32();
                    long next = fs.Position + size + (size % 2);
                    if (id == "fmt ")
                    {
                        r.ReadInt16(); channels = r.ReadInt16(); rate = r.ReadInt32();
                        r.ReadInt32(); r.ReadInt16(); bits = r.ReadInt16();
                    }
                    else if (id == "data")
                    {
                        int frames = size / 2;
                        for (int i = 0; i < frames; i++) data.Add(r.ReadInt16());
                    }
                    if (next > fs.Length) break;
                    fs.Position = next;
                }
                var mono = new List<short>(data.Count);
                for (int i = 0; i + channels - 1 < data.Count; i += channels)
                    mono.Add(data[i]);
                return mono.ToArray();
            }
        }

        // ---------------- continuous raw PCM to stdout (供流式 ASR) ----------------

        static void CmdCaptureStream(Dictionary<string, string> o)
        {
            string sel = Get(o, "device", null);
            string mode = Get(o, "mode", "loopback").ToLowerInvariant();
            double gain = 1.0;
            double.TryParse(Get(o, "gain", "1"), NumberStyles.Float, CultureInfo.InvariantCulture, out gain);
            if (gain <= 0) gain = 1.0;
            bool loopback = mode != "device";
            var dev = loopback ? FindDevice(0, string.IsNullOrEmpty(sel), sel)
                               : FindDevice(1, string.IsNullOrEmpty(sel), sel);

            object oClient;
            dev.Activate(typeof(IAudioClient).GUID, 0x17, IntPtr.Zero, out oClient);
            var client = (IAudioClient)oClient;
            IntPtr fmtPtr; client.GetMixFormat(out fmtPtr);
            var fmt = (WAVEFORMATEX)Marshal.PtrToStructure(fmtPtr, typeof(WAVEFORMATEX));
            int srcRate = (int)fmt.nSamplesPerSec;
            int srcCh = fmt.nChannels;
            bool isFloat = fmt.wBitsPerSample == 32;

            int hr = client.Initialize(0, loopback ? 0x00020000 : 0, 10000000L, 0L, fmtPtr, IntPtr.Zero);
            if (hr != 0) throw new Exception("Initialize hr=0x" + hr.ToString("X8"));
            int bufFrames; client.GetBufferSize(out bufFrames);
            object oCap; client.GetService(typeof(IAudioCaptureClient).GUID, out oCap);
            var cap = (IAudioCaptureClient)oCap;

            var stdout = Console.OpenStandardOutput();
            client.Start();
            Console.Error.WriteLine("STREAM OK rate=" + srcRate + " ch=" + srcCh + " float=" + isFloat);
            while (true)
            {
                int packet; cap.GetNextPacketSize(out packet);
                if (packet == 0) { Thread.Sleep(5); continue; }
                IntPtr data; int nFrames; int flags; long pos; long qpc;
                cap.GetBuffer(out data, out nFrames, out flags, out pos, out qpc);
                if (nFrames > 0 && flags == 0)
                {
                    int bytes = nFrames * srcCh * (fmt.wBitsPerSample / 8);
                    byte[] buf = new byte[bytes];
                    Marshal.Copy(data, buf, 0, bytes);
                    var pcm = new List<short>();
                    AppendMono(buf, nFrames, srcCh, isFloat, pcm, gain);
                    short[] mono = Resample(pcm, srcRate, 16000);
                    var outBuf = new byte[mono.Length * 2];
                    Buffer.BlockCopy(mono, 0, outBuf, 0, outBuf.Length);
                    stdout.Write(outBuf, 0, outBuf.Length);
                    stdout.Flush();
                }
                cap.ReleaseBuffer(nFrames);
            }
        }
        // ---------------- streaming playback (TTS 边合成边播) ----------------

        static void CmdStreamPlay(Dictionary<string, string> o)
        {
            string sel = Get(o, "device", null);
            int inRate = GetInt(o, "rate", 16000);
            var dev = FindDevice(0, string.IsNullOrEmpty(sel), sel);
            object oClient;
            dev.Activate(typeof(IAudioClient).GUID, 0x17, IntPtr.Zero, out oClient);
            var client = (IAudioClient)oClient;
            IntPtr fmtPtr; client.GetMixFormat(out fmtPtr);
            var fmt = (WAVEFORMATEX)Marshal.PtrToStructure(fmtPtr, typeof(WAVEFORMATEX));
            int devRate = (int)fmt.nSamplesPerSec;
            int devCh = fmt.nChannels;
            bool devFloat = fmt.wBitsPerSample == 32;

            int hr = client.Initialize(0, 0, 1000000L, 0L, fmtPtr, IntPtr.Zero);
            if (hr != 0) throw new Exception("Initialize hr=0x" + hr.ToString("X8"));
            int bufFrames; client.GetBufferSize(out bufFrames);
            object oRen; client.GetService(typeof(IAudioRenderClient).GUID, out oRen);
            var ren = (IAudioRenderClient)oRen;

            client.Start();
            var stdin = Console.OpenStandardInput();
            var raw = new byte[3200]; // 100ms @16k mono
            long total = 0;
            int read;
            while ((read = stdin.Read(raw, 0, raw.Length)) > 0)
            {
                int frames = read / 2;
                if (frames <= 0) continue;
                var src = new List<short>(frames);
                for (int i = 0; i < frames; i++) src.Add(BitConverter.ToInt16(raw, i * 2));
                short[] pcm = Resample(src, inRate, devRate);
                int sent = 0;
                while (sent < pcm.Length)
                {
                    int padding; client.GetCurrentPadding(out padding);
                    int avail = bufFrames - padding;
                    if (avail <= 0) { Thread.Sleep(4); continue; }
                    int f = Math.Min(avail, pcm.Length - sent);
                    IntPtr buf; ren.GetBuffer(f, out buf);
                    if (devFloat)
                    {
                        float[] arr = new float[f * devCh];
                        for (int i = 0; i < f; i++)
                        {
                            float v = pcm[sent + i] / 32768f;
                            for (int c = 0; c < devCh; c++) arr[i * devCh + c] = v;
                        }
                        Marshal.Copy(arr, 0, buf, arr.Length);
                    }
                    else
                    {
                        short[] arr = new short[f * devCh];
                        for (int i = 0; i < f; i++)
                            for (int c = 0; c < devCh; c++) arr[i * devCh + c] = pcm[sent + i];
                        Marshal.Copy(arr, 0, buf, arr.Length);
                    }
                    ren.ReleaseBuffer(f, 0);
                    sent += f;
                    total += f;
                    Thread.Sleep(1);
                }
            }
            Thread.Sleep(400);
            client.Stop();
            Console.Error.WriteLine("OK streamed frames=" + total);
        }
        // ---------------- play ----------------

        static void CmdPlay(Dictionary<string, string> o)
        {
            string file = Get(o, "file", null);
            if (string.IsNullOrEmpty(file)) throw new Exception("--file required");
            int rate;
            short[] mono = ReadWav16(file, out rate);
            string sel = Get(o, "device", null);
            var dev = FindDevice(0, string.IsNullOrEmpty(sel), sel);

            object oClient;
            dev.Activate(typeof(IAudioClient).GUID, 0x17, IntPtr.Zero, out oClient);
            var client = (IAudioClient)oClient;

            IntPtr fmtPtr; client.GetMixFormat(out fmtPtr);
            var fmt = (WAVEFORMATEX)Marshal.PtrToStructure(fmtPtr, typeof(WAVEFORMATEX));
            int devRate = (int)fmt.nSamplesPerSec;
            int devCh = fmt.nChannels;
            bool devFloat = fmt.wBitsPerSample == 32;
            if (!devFloat && fmt.wBitsPerSample != 16)
                throw new Exception("unsupported device sample format: " + fmt.wBitsPerSample + "bit");

            int hr = client.Initialize(0, 0, 1000000L, 0L, fmtPtr, IntPtr.Zero);
            if (hr != 0) throw new Exception("Initialize hr=0x" + hr.ToString("X8"));
            int bufFrames; client.GetBufferSize(out bufFrames);

            object oRen;
            client.GetService(typeof(IAudioRenderClient).GUID, out oRen);
            var ren = (IAudioRenderClient)oRen;

            short[] pcm = Resample(new List<short>(mono), rate, devRate);
            int total = pcm.Length;
            int sent = 0;

            client.Start();
            while (sent < total)
            {
                int padding; client.GetCurrentPadding(out padding);
                int avail = bufFrames - padding;
                if (avail <= 0) { Thread.Sleep(5); continue; }
                int frames = Math.Min(avail, total - sent);
                IntPtr buf; ren.GetBuffer(frames, out buf);
                if (devFloat)
                {
                    float[] f = new float[frames * devCh];
                    for (int i = 0; i < frames; i++)
                    {
                        float v = pcm[sent + i] / 32768f;
                        for (int c = 0; c < devCh; c++) f[i * devCh + c] = v;
                    }
                    Marshal.Copy(f, 0, buf, f.Length);
                }
                else
                {
                    short[] s = new short[frames * devCh];
                    for (int i = 0; i < frames; i++)
                        for (int c = 0; c < devCh; c++) s[i * devCh + c] = pcm[sent + i];
                    Marshal.Copy(s, 0, buf, s.Length);
                }
                ren.ReleaseBuffer(frames, 0);
                sent += frames;
                Thread.Sleep(1);
            }
            Thread.Sleep(300);
            client.Stop();
            Console.WriteLine("OK played frames=" + sent + " rate=" + devRate + " ch=" + devCh);
        }

        // ---------------- tts ----------------

        static void CmdVoices()
        {
            using (var s = new SpeechSynthesizer())
            {
                foreach (var v in s.GetInstalledVoices())
                {
                    var i = v.VoiceInfo;
                    Console.WriteLine(i.Name + "\t" + i.Culture.Name + "\t" + i.Gender);
                }
            }
        }

        static void CmdTts(Dictionary<string, string> o)
        {
            string text = Get(o, "text", null);
            string outFile = Get(o, "out", null);
            if (string.IsNullOrEmpty(text) || string.IsNullOrEmpty(outFile))
                throw new Exception("--text and --out required");
            using (var s = new SpeechSynthesizer())
            {
                string voice = Get(o, "voice", null);
                if (!string.IsNullOrEmpty(voice))
                {
                    try { s.SelectVoice(voice); }
                    catch (Exception) { /* 指定音色不存在时退回默认 */ }
                }
                s.Rate = GetInt(o, "rate", 0);
                s.Volume = 100;
                s.SetOutputToWaveFile(outFile, new SpeechAudioFormatInfo(16000, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
                s.Speak(text);
                s.SetOutputToNull();
            }
            Console.WriteLine("OK out=" + outFile);
        }

        static void CmdMeters()
        {
            var en = CreateEnumerator();
            IMMDeviceCollection col;
            en.EnumAudioEndpoints(0, 1, out col);
            int n; col.GetCount(out n);
            Console.OutputEncoding = Encoding.UTF8;
            for (int i = 0; i < n; i++)
            {
                IMMDevice dev; col.Item(i, out dev);
                string name = FriendlyName(dev);
                float peak = 0f;
                try
                {
                    object oMeter;
                    dev.Activate(typeof(IAudioMeterInformation).GUID, 0x17, IntPtr.Zero, out oMeter);
                    var meter = (IAudioMeterInformation)oMeter;
                    float max = 0f;
                    for (int k = 0; k < 12; k++)
                    {
                        float v; meter.GetPeakValue(out v);
                        if (v > max) max = v;
                        Thread.Sleep(15);
                    }
                    peak = max;
                    Marshal.ReleaseComObject(meter);
                }
                catch { }
                Console.WriteLine(name + "\t" + peak.ToString("F4", CultureInfo.InvariantCulture));
            }
            Marshal.ReleaseComObject(col);
        }
        static void CmdRms(Dictionary<string, string> o)
        {
            string file = Get(o, "file", null);
            if (string.IsNullOrEmpty(file)) throw new Exception("--file required");
            int rate;
            short[] data = ReadWav16(file, out rate);
            if (data.Length == 0) { Console.WriteLine("RMS 0 samples=0"); return; }
            double sum = 0;
            int peak = 0;
            foreach (short s in data) { sum += (double)s * s; int a = Math.Abs((int)s); if (a > peak) peak = a; }
            double rms = Math.Sqrt(sum / data.Length) / 32768.0;
            Console.WriteLine("RMS " + rms.ToString("F6", CultureInfo.InvariantCulture) + " peak " + peak + " samples " + data.Length + " rate " + rate);
        }

        static void CmdTone(Dictionary<string, string> o)
        {
            string outFile = Get(o, "out", null);
            if (string.IsNullOrEmpty(outFile)) throw new Exception("--out required");
            int seconds = GetInt(o, "seconds", 2);
            double freq = 440.0;
            double.TryParse(Get(o, "freq", "440"), NumberStyles.Float, CultureInfo.InvariantCulture, out freq);
            int rate = 16000;
            var data = new short[rate * seconds];
            for (int i = 0; i < data.Length; i++)
                data[i] = (short)(Math.Sin(2 * Math.PI * freq * i / rate) * 8000);
            WriteWav16(outFile, data, rate);
            Console.WriteLine("OK out=" + outFile + " samples=" + data.Length);
        }

        // ---------------- interop ----------------

        // ---- process loopback interop ----
        [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = true, CharSet = CharSet.Unicode)]
        static extern int ActivateAudioInterfaceAsync(
            [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
            ref Guid riid,
            IntPtr activationParams,
            IntPtr completionHandler,
            out IActivateAudioInterfaceAsyncOperation operation);

        [StructLayout(LayoutKind.Sequential)]
        struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS
        {
            public int TargetProcessId;
            public int ProcessLoopbackMode;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct AUDIOCLIENT_ACTIVATION_PARAMS
        {
            public int ActivationType;
            public AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
        }

        [StructLayout(LayoutKind.Explicit)]
        struct PROPVARIANT_BLOB
        {
            [FieldOffset(0)] public ushort vt;
            [FieldOffset(8)] public uint cbSize;
            [FieldOffset(16)] public IntPtr pBlobData;
        }

        [ComVisible(true)]
        [ClassInterface(ClassInterfaceType.None)]
        class ActivationHandler : IActivateAudioInterfaceCompletionHandler
        {
            public readonly ManualResetEventSlim Done = new ManualResetEventSlim(false);
            public int Hr = -1;
            public object Client;
            public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation)
            {
                int hr;
                object client;
                operation.GetActivateResult(out hr, out client);
                Hr = hr;
                Client = client;
                Done.Set();
            }
        }

        [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IActivateAudioInterfaceCompletionHandler
        {
            void ActivateCompleted([MarshalAs(UnmanagedType.Interface)] IActivateAudioInterfaceAsyncOperation activateOperation);
        }

        [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IActivateAudioInterfaceAsyncOperation
        {
            void GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
        }
        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
        class MMDeviceEnumeratorComObject { }

        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceEnumerator
        {
            int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
            int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
            int GetDevice(string id, out IMMDevice device);
            int RegisterEndpointNotificationCallback(IntPtr client);
            int UnregisterEndpointNotificationCallback(IntPtr client);
        }

        [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceCollection
        {
            int GetCount(out int count);
            int Item(int index, out IMMDevice device);
        }

        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDevice
        {
            int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
            int OpenPropertyStore(int access, out IPropertyStore props);
            int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
            int GetState(out int state);
        }

        [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IPropertyStore
        {
            int GetCount(out int count);
            int GetAt(int index, out PROPERTYKEY key);
            int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
            int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
            int Commit();
        }

        [StructLayout(LayoutKind.Sequential)]
        struct PROPERTYKEY { public Guid fmtid; public int pid; }

        [StructLayout(LayoutKind.Explicit)]
        struct PROPVARIANT
        {
            [FieldOffset(0)] public ushort vt;
            [FieldOffset(8)] public IntPtr pwszVal;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct WAVEFORMATEX
        {
            public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec;
            public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize;
        }

        [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioMeterInformation
        {
            int GetPeakValue(out float peak);
            int GetMeteringChannelCount(out int count);
            int GetChannelsPeakValues(int count, [Out, MarshalAs(UnmanagedType.LPArray)] float[] peaks);
            int QueryHardwareSupport(out int mask);
        }
        [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionManager2
        {
            int GetAudioSessionControl(IntPtr audioSessionGuid, int streamFlags, out IntPtr sessionControl);
            int GetSimpleAudioVolume(IntPtr audioSessionGuid, int streamFlags, out IntPtr audioVolume);
            int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
            int RegisterSessionNotification(IntPtr notification);
            int UnregisterSessionNotification(IntPtr notification);
            int RegisterDuckNotification(string sessionId, IntPtr notification);
            int UnregisterDuckNotification(IntPtr notification);
        }

        [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionEnumerator
        {
            int GetCount(out int count);
            int GetSession(int index, out IAudioSessionControl session);
        }

        [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionControl
        {
            int GetState(out int state);
        }

        [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionControl2
        {
            int GetState(out int state);
            int GetDisplayName(out IntPtr name);
            int SetDisplayName(string name, IntPtr guid);
            int GetIconPath(out IntPtr path);
            int SetIconPath(string path, IntPtr guid);
            int GetGroupingParam(out Guid g);
            int SetGroupingParam(ref Guid g, IntPtr ctx);
            int RegisterAudioSessionNotification(IntPtr n);
            int UnregisterAudioSessionNotification(IntPtr n);
            int GetSessionIdentifier(out IntPtr id);
            int GetSessionInstanceIdentifier(out IntPtr id);
            int GetProcessId(out int pid);
            int IsSystemSoundsSession();
            int SetDuckingPreference(bool opt);
        }
        [ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioClient
        {
            int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr audioSessionGuid);
            int GetBufferSize(out int frames);
            int GetStreamLatency(out long latency);
            int GetCurrentPadding(out int frames);
            int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
            int GetMixFormat(out IntPtr format);
            int GetDevicePeriod(out long defaultPeriod, out long minPeriod);
            int Start();
            int Stop();
            int Reset();
            int SetEventHandle(IntPtr handle);
            int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
        }

        [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioCaptureClient
        {
            int GetBuffer(out IntPtr data, out int frames, out int flags, out long devicePosition, out long qpcPosition);
            int ReleaseBuffer(int frames);
            int GetNextPacketSize(out int frames);
        }

        [ComImport, Guid("F294ACFC-3146-4483-A7BF-ADDCA7C260E2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioRenderClient
        {
            int GetBuffer(int frames, out IntPtr buffer);
            int ReleaseBuffer(int frames, int flags);
        }
    }
}
