import { test } from 'node:test'
import { check } from './ui-shared-contract.mjs'
test('app-source-consistency - shared contract 1 (app)', () => check('app'))
test('app-source-consistency - shared contract 2 (shared)', () => check('shared'))
test('app-source-consistency - shared contract 3 (app)', () => check('app'))
test('app-source-consistency - shared contract 4 (tabs)', () => check('tabs'))

