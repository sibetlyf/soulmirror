import { test } from 'node:test'
import { check } from './ui-shared-contract.mjs'
test('float-entry-button - shared contract 1 (entry)', () => check('entry'))
test('float-entry-button - shared contract 2 (close)', () => check('close'))
test('float-entry-button - shared contract 3 (entry)', () => check('entry'))
test('float-entry-button - shared contract 4 (close)', () => check('close'))

