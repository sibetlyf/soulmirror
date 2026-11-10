import { test } from 'node:test'
import { check } from './ui-shared-contract.mjs'
test('float-monitor - shared contract 1 (layout)', () => check('layout'))
test('float-monitor - shared contract 2 (shared)', () => check('shared'))
test('float-monitor - shared contract 3 (issues)', () => check('issues'))
test('float-monitor - shared contract 4 (tabs)', () => check('tabs'))
test('float-monitor - shared contract 5 (close)', () => check('close'))
test('autoOpen configuration is respected and next run reopens after close', () => check('auto'))
test('elapsed and actual transcription activity remain visible', () => check('elapsed'))
test('float-monitor - shared contract 7 (old)', () => check('old'))
test('float-monitor - shared contract 8 (tabs)', () => check('tabs'))

