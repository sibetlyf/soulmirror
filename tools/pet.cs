// SoulMirror 桌面宠物：一个无边框、总是在最前的小窗口，显示会议助手的状态。
//
// 为什么用 WinForms + csc：和 mbridge 一样零依赖——系统自带 .NET Framework 的
// csc.exe 直接编译，不需要 NuGet、不需要装 Electron。
//
// 它只做三件事：
//   1. 每 1.2 秒拉一次 /api/soulmirror/status，把结果画成一张脸 + 一句话
//   2. 可拖动，位置记在 pet.json 里
//   3. 右键菜单直接操作会议助手（开始/结束录音、开关 Agent、打开面板）

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

static class Pet
{
    static string BaseUrl = "http://127.0.0.1:3080";
    static string StatePath = "";
    static string Key = "idle";
    static string Label = "待命中";
    static string Text = "";
    static string Hint = "";
    static Color Tint = Color.FromArgb(139, 149, 165);
    static DateTime LastOk = DateTime.MinValue;
    static string LastError = "";
    static int Msg = 0;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    [STAThread]
    static void Main(string[] args)
    {
        foreach (var a in args)
        {
            if (a.StartsWith("--url=")) BaseUrl = a.Substring(6).TrimEnd('/');
            else if (a.StartsWith("--state=")) StatePath = a.Substring(8);
        }
        if (StatePath.Length == 0)
            StatePath = Path.Combine(Path.GetTempPath(), "soulmirror-pet.json");

        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var f = new PetForm();
        Application.Run(f);
    }

    // ── 状态拉取 ────────────────────────────────────────────
    public static void Refresh()
    {
        try
        {
            var json = Get(BaseUrl + "/api/soulmirror/status", 2500);
            ParseState(json);
            LastOk = DateTime.Now;
            LastError = "";
        }
        catch (Exception e)
        {
            LastError = e.Message;
            if ((DateTime.Now - LastOk).TotalSeconds > 12)
            {
                Key = "error"; Label = "连不上 DSH"; Text = ""; Hint = "";
                Tint = Color.FromArgb(220, 38, 38);
            }
        }
    }

    static string Get(string url, int timeoutMs)
    {
        var req = (HttpWebRequest)WebRequest.Create(url);
        req.Timeout = timeoutMs;
        req.ReadWriteTimeout = timeoutMs;
        req.Proxy = null;
        using (var resp = (HttpWebResponse)req.GetResponse())
        using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
            return sr.ReadToEnd();
    }

    static string Post(string path, string body)
    {
        var req = (HttpWebRequest)WebRequest.Create(BaseUrl + path);
        req.Method = "POST";
        req.ContentType = "application/json; charset=utf-8";
        req.Timeout = 6000;
        req.Proxy = null;
        var bytes = Encoding.UTF8.GetBytes(body ?? "{}");
        req.ContentLength = bytes.Length;
        using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
        try
        {
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                return sr.ReadToEnd();
        }
        catch (WebException e)
        {
            if (e.Response == null) throw;
            using (var sr = new StreamReader(e.Response.GetResponseStream(), Encoding.UTF8))
                return sr.ReadToEnd();
        }
    }

    // ── 极简 JSON 取值（不引第三方库）────────────────────────
    static string Raw(string json, string path)
    {
        // 支持 a.b 形式；遇到数组/对象就返回原始片段
        object cur = json;
        var src = json;
        foreach (var part in path.Split('.'))
        {
            var m = Regex.Match(src, "\"" + Regex.Escape(part) + "\"\\s*:\\s*(\"((?:[^\"\\\\]|\\\\.)*)\"|\\{[^{}]*\\}|\\[[^\\[\\]]*\\]|-?[0-9.]+|true|false|null)");
            if (!m.Success) return "";
            src = m.Groups[1].Value;
        }
        if (src.Length >= 2 && src[0] == '"') return Unescape(src.Substring(1, src.Length - 2));
        return src;
    }

    static string Unescape(string s)
    {
        if (s == null || s.IndexOf('\\') < 0) return s ?? "";
        var sb = new StringBuilder();
        for (int i = 0; i < s.Length; i++)
        {
            if (s[i] != '\\' || i + 1 >= s.Length) { sb.Append(s[i]); continue; }
            char n = s[++i];
            switch (n)
            {
                case 'n': sb.Append('\n'); break;
                case 't': sb.Append(' '); break;
                case 'r': break;
                case 'u':
                    if (i + 4 < s.Length)
                    {
                        sb.Append((char)Convert.ToInt32(s.Substring(i + 1, 4), 16));
                        i += 4;
                    }
                    break;
                default: sb.Append(n); break;
            }
        }
        return sb.ToString();
    }

    static void ParseState(string json)
    {
        // 与 lib/pet-state.js 同构：整理 > 说话 > 出错 > 在听 > 待命
        var pmPhase = Raw(json, "postMeeting.phase");
        if (!string.IsNullOrEmpty(pmPhase) && pmPhase != "idle")
        {
            if (pmPhase == "error") { Set("error", "整理失败", Raw(json, "postMeeting.error"), ""); return; }
            if (pmPhase == "done")
            {
                var n = Raw(json, "postMeeting.sentences");
                var sp = Raw(json, "postMeeting.speakers");
                var t = "整理完成";
                if (!string.IsNullOrEmpty(n)) t += "：" + n + " 句";
                if (!string.IsNullOrEmpty(sp)) t += " · " + sp + " 位";
                Set("idle", "整理完成", t, Raw(json, "postMeeting.minutesPath"));
                return;
            }
            var stage = pmPhase == "stopping" ? "收尾中" : (pmPhase == "offline" ? "重转写中" : "生成纪要中");
            Set("sweeping", "会后整理中", stage, "");
            return;
        }

        var spoken = Raw(json, "replyState.spoken");
        if (!string.IsNullOrEmpty(spoken)) { Set("speaking", "正在说话", Shorten(spoken, 24), ""); return; }

        var speakErr = Raw(json, "lastSpeakError.message");
        if (!string.IsNullOrEmpty(speakErr)) { Set("error", "出问题了", Shorten(speakErr, 24), ""); return; }

        var capturing = Raw(json, "session.capturing");
        if (capturing == "true")
        {
            var lines = Raw(json, "session.lines");
            var title = Raw(json, "meeting.title");
            Set("listening", "在听会议", string.IsNullOrEmpty(lines) ? "" : lines + " 句", title);
            return;
        }

        var replyOn = Raw(json, "reply.enabled");
        Set("idle", "待命中", replyOn == "true" ? "Agent 已开" : "只转录", "");
    }

    static string Shorten(string s, int n)
    {
        s = s.Replace("\r", " ").Replace("\n", " ").Trim();
        return s.Length <= n ? s : s.Substring(0, n) + "…";
    }

    static void Set(string key, string label, string text, string hint)
    {
        Key = key; Label = label; Text = text ?? ""; Hint = hint ?? "";
        switch (key)
        {
            case "listening": Tint = Color.FromArgb(47, 124, 246); break;
            case "speaking": Tint = Color.FromArgb(22, 163, 74); break;
            case "thinking": Tint = Color.FromArgb(168, 85, 247); break;
            case "sweeping": Tint = Color.FromArgb(245, 158, 11); break;
            case "error": Tint = Color.FromArgb(220, 38, 38); break;
            default: Tint = Color.FromArgb(139, 149, 165); break;
        }
    }

    // ── 窗口 ───────────────────────────────────────────────
    sealed class PetForm : Form
    {
        readonly Timer _timer = new Timer();
        Point _dragStart;
        bool _dragging;
        ContextMenuStrip _menu;
        readonly int W = 196;
        readonly int H = 244;

        public PetForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            // 不用 TransparencyKey：抠图会让文字叠在透明像素上、发虚看不清。
            // 改成实心卡片，圆角由绘制实现，双击标题栏一样能拖动。
            BackColor = Color.FromArgb(250, 251, 253);
            Size = new Size(W, H);
            DoubleBuffered = true;
            Text = "SoulMirror Pet";

            var pos = LoadPos();
            Location = new Point(pos.X, pos.Y);

            _menu = BuildMenu();
            ContextMenuStrip = _menu;

            _timer.Interval = 1200;
            _timer.Tick += (s, e) => { Pet.Refresh(); Invalidate(); };
            _timer.Start();
            Pet.Refresh();

            MouseDown += OnDown;
            MouseMove += OnMove;
            MouseUp += OnUp;
            DoubleClick += (s, e) => OpenPanel();
            Shown += (s, e) => { PositionDefault(); Invalidate(); };
        }

        void PositionDefault()
        {
            // 用光标所在屏幕的工作区右下角；多屏 + 高 DPI 下也别跑到屏幕外
            var scr = Screen.FromPoint(Cursor.Position) ?? Screen.PrimaryScreen;
            var wa = scr.WorkingArea;
            var x = wa.Right - Width - 24;
            var y = wa.Bottom - Height - 24;
            if (Location.X < wa.Left || Location.X > wa.Right - 80 || Location.Y < wa.Top || Location.Y > wa.Bottom - 80)
                Location = new Point(x, y);
        }

        Point LoadPos()
        {
            try
            {
                if (File.Exists(Pet.StatePath))
                {
                    var txt = File.ReadAllText(Pet.StatePath);
                    var mx = Regex.Match(txt, "\"x\"\\s*:\\s*(-?[0-9]+)");
                    var my = Regex.Match(txt, "\"y\"\\s*:\\s*(-?[0-9]+)");
                    if (mx.Success && my.Success)
                        return new Point(int.Parse(mx.Groups[1].Value), int.Parse(my.Groups[1].Value));
                }
            }
            catch { }
            return new Point(-1, -1);
        }

        void SavePos()
        {
            try
            {
                File.WriteAllText(Pet.StatePath, "{\"x\":" + Location.X + ",\"y\":" + Location.Y + "}");
            }
            catch { }
        }

        ContextMenuStrip BuildMenu()
        {
            var m = new ContextMenuStrip();
            m.Items.Add(new ToolStripMenuItem("打开会议助手", null, (s, e) => OpenPanel()));
            m.Items.Add(new ToolStripSeparator());
            m.Items.Add(new ToolStripMenuItem("开始录音", null, (s, e) => Act("/api/soulmirror/auto", "{\"action\":\"start\"}")));
            m.Items.Add(new ToolStripMenuItem("结束录音（会后自动整理）", null, (s, e) => Act("/api/soulmirror/auto", "{\"action\":\"stop\"}")));
            m.Items.Add(new ToolStripSeparator());
            m.Items.Add(new ToolStripMenuItem("切换 Agent 发言", null, (s, e) => ToggleReply()));
            m.Items.Add(new ToolStripMenuItem("切换 建议卡片", null, (s, e) => ToggleAdvice()));
            m.Items.Add(new ToolStripSeparator());
            m.Items.Add(new ToolStripMenuItem("刷新", null, (s, e) => { Pet.Refresh(); Invalidate(); }));
            m.Items.Add(new ToolStripMenuItem("退出宠物", null, (s, e) => Close()));
            return m;
        }

        void ToggleReply()
        {
            try
            {
                var st = Pet.Get(Pet.BaseUrl + "/api/soulmirror/status", 2500);
                var on = Pet.Raw(st, "reply.enabled") == "true";
                Pet.Post("/api/soulmirror/reply", "{\"enabled\":" + (on ? "false" : "true") + "}");
            }
            catch (Exception e) { Notify("操作失败：" + e.Message); }
            Pet.Refresh(); Invalidate();
        }

        void ToggleAdvice()
        {
            try
            {
                var st = Pet.Get(Pet.BaseUrl + "/api/soulmirror/status", 2500);
                var on = Pet.Raw(st, "advice.enabled") == "true";
                Pet.Post("/api/soulmirror/advice", "{\"enabled\":" + (on ? "false" : "true") + "}");
            }
            catch (Exception e) { Notify("操作失败：" + e.Message); }
            Pet.Refresh(); Invalidate();
        }

        void Act(string path, string body)
        {
            try { Pet.Post(path, body); }
            catch (Exception e) { Notify("操作失败：" + e.Message); }
            Pet.Refresh(); Invalidate();
        }

        void OpenPanel()
        {
            try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(Pet.BaseUrl) { UseShellExecute = true }); }
            catch { }
        }

        void Notify(string text)
        {
            if (++Pet.Msg > 3) return; // 别一直弹
            try
            {
                var tip = new ToolTip();
                tip.Show(text, this, W / 2, 0, 4000);
            }
            catch { }
        }

        void OnDown(object s, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            _dragging = true;
            _dragStart = e.Location;
        }

        void OnMove(object s, MouseEventArgs e)
        {
            if (!_dragging) return;
            Location = new Point(Location.X + e.X - _dragStart.X, Location.Y + e.Y - _dragStart.Y);
        }

        void OnUp(object s, MouseEventArgs e)
        {
            if (!_dragging) return;
            _dragging = false;
            SavePos();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            // 卡片底
            var card = new Rectangle(2, 2, W - 5, H - 5);
            using (var bg = new SolidBrush(Color.FromArgb(252, 253, 255)))
                g.FillPath(bg, Round(card, 18));
            using (var pen = new Pen(Color.FromArgb(70, Pet.Tint), 1.6f))
                g.DrawPath(pen, Round(card, 18));

            int cx = W / 2;
            int faceR = 46;
            var faceRect = new Rectangle(cx - faceR, 16, faceR * 2, faceR * 2);

            using (var glow = new SolidBrush(Color.FromArgb(40, Pet.Tint)))
                g.FillEllipse(glow, faceRect.X - 9, faceRect.Y - 9, faceRect.Width + 18, faceRect.Height + 18);

            using (var fill = new LinearGradientBrush(faceRect, Lighten(Pet.Tint, 0.60), Lighten(Pet.Tint, 0.30), 90f))
                g.FillEllipse(fill, faceRect);
            using (var pen = new Pen(Pet.Tint, 3f))
                g.DrawEllipse(pen, faceRect);

            DrawFace(g, faceRect);

            // 状态条：实心色块 + 白字，保证任何背景都清楚
            var chip = new Rectangle(14, faceRect.Bottom + 12, W - 28, 28);
            using (var b = new SolidBrush(Pet.Tint))
                g.FillPath(b, Round(chip, 14));
            using (var f = new Font("Microsoft YaHei UI", 9.4f, FontStyle.Bold))
            using (var br = new SolidBrush(Color.White))
            {
                var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                g.DrawString(Pet.Label, f, br, chip, sf);
            }

            // 详情：两行，深灰字，直接画在卡片上
            var detail = new Rectangle(10, chip.Bottom + 8, W - 20, 42);
            using (var f = new Font("Microsoft YaHei UI", 8.6f))
            using (var br = new SolidBrush(Color.FromArgb(64, 72, 86)))
            {
                var sf = new StringFormat
                {
                    Alignment = StringAlignment.Center,
                    LineAlignment = StringAlignment.Near,
                    Trimming = StringTrimming.EllipsisCharacter,
                };
                var body = Pet.Text;
                if (!string.IsNullOrEmpty(Pet.Hint))
                    body = (body.Length > 0 ? body + "\n" : "") + Pet.Hint;
                g.DrawString(body, f, br, detail, sf);
            }
        }

        static void DrawFace(Graphics g, Rectangle r)
        {
            float cx = r.X + r.Width / 2f;
            float cy = r.Y + r.Height / 2f;
            float ew = r.Width * 0.17f;
            float eh = r.Height * 0.19f;
            using (var eye = new SolidBrush(Color.FromArgb(38, 44, 56)))
            using (var pen = new Pen(Color.FromArgb(38, 44, 56), 3.2f))
            {
                float ey = cy - r.Height * 0.10f;
                if (Pet.Key == "sleeping" || Pet.Key == "idle")
                {
                    g.DrawArc(pen, cx - r.Width * 0.30f, ey, ew * 2.2f, eh * 1.2f, 200, 140);
                    g.DrawArc(pen, cx + r.Width * 0.08f, ey, ew * 2.2f, eh * 1.2f, 200, 140);
                }
                else
                {
                    g.FillEllipse(eye, cx - r.Width * 0.28f, ey, ew, eh);
                    g.FillEllipse(eye, cx + r.Width * 0.12f, ey, ew, eh);
                    // 高光
                    using (var hi = new SolidBrush(Color.FromArgb(220, Color.White)))
                    {
                        g.FillEllipse(hi, cx - r.Width * 0.28f + ew * 0.25f, ey + eh * 0.18f, ew * 0.34f, eh * 0.34f);
                        g.FillEllipse(hi, cx + r.Width * 0.12f + ew * 0.25f, ey + eh * 0.18f, ew * 0.34f, eh * 0.34f);
                    }
                }

                float my = cy + r.Height * 0.16f;
                if (Pet.Key == "speaking")
                {
                    // 张嘴说话
                    var mb = new RectangleF(cx - r.Width * 0.16f, my - 6, r.Width * 0.32f, r.Height * 0.16f);
                    g.FillEllipse(eye, mb);
                }
                else if (Pet.Key == "error")
                {
                    g.DrawArc(pen, cx - r.Width * 0.18f, my + 4, r.Width * 0.36f, r.Height * 0.14f, 200, 140);
                }
                else
                {
                    g.DrawArc(pen, cx - r.Width * 0.20f, my - 2, r.Width * 0.40f, r.Height * 0.16f, 20, 140);
                }
            }
        }

        static Color Lighten(Color c, double k)
        {
            return Color.FromArgb(
                (int)Math.Min(255, c.R + (255 - c.R) * k),
                (int)Math.Min(255, c.G + (255 - c.G) * k),
                (int)Math.Min(255, c.B + (255 - c.B) * k));
        }

        static GraphicsPath Round(Rectangle r, int radius)
        {
            var p = new GraphicsPath();
            int d = radius * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }
    }
}
