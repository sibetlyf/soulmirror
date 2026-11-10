import { test } from 'node:test'
import { check } from './ui-shared-contract.mjs'
test('progress-visible - shared contract 1 (progress)', () => check('progress'))
test('progress-visible - shared contract 2 (shared)', () => check('shared'))
test('progress-visible - shared contract 3 (shared)', () => check('shared'))
test('progress-visible - shared contract 4 (progress)', () => check('progress'))
test('progress-visible - shared contract 5 (shared)', () => check('shared'))

