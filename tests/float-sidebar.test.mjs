import { test } from 'node:test'
import { check } from './ui-shared-contract.mjs'
test('float-sidebar - shared contract 1 (layout)', () => check('layout'))
test('float-sidebar - shared contract 2 (layout)', () => check('layout'))
test('float-sidebar - shared contract 3 (layout)', () => check('layout'))
test('float-sidebar - shared contract 4 (close)', () => check('close'))

