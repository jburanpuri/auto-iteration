import test from 'node:test';
import assert from 'node:assert/strict';
import { customers, filterCustomers } from './customers.mjs';
test('search and status filters compose without altering the customer data', () => {
  assert.equal(filterCustomers(customers, 'ADA', 'Active')[0].name, 'Ada Chen');
  assert.equal(filterCustomers(customers, 'ADA', 'Trial').length, 0);
  assert.equal(filterCustomers(customers, '', 'all').length, 8);
  assert.equal(filterCustomers(customers, '', 'Archived').length, 0);
  assert.equal(customers.length, 8);
});
