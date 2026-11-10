import { test } from 'node:test'
import { check } from './ui-shared-contract.mjs'
test('float-parity - shared contract 1 (shared)', () => check('shared'))
test('float-parity - shared contract 2 (tabs)', () => check('tabs'))
test('float-parity - shared contract 3 (tabs)', () => check('tabs'))

