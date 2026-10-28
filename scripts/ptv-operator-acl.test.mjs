import assert from 'node:assert/strict';
import test from 'node:test';
import { operatorAclSafe } from './ptv-workspace-preflight.mjs';

const record = () => ({
    ownerSid: 'S-1-5-32-544',
    aces: [
        { sid: 'S-1-5-32-545', type: 'Allow', rights: 131097, propagation: 'None' },
        { sid: 'S-1-5-32-544', type: 'Allow', rights: 983103, propagation: 'None' },
        { sid: 'S-1-5-18', type: 'Allow', rights: 983103, propagation: 'None' },
        { sid: 'S-1-3-0', type: 'Allow', rights: 983103, propagation: 'InheritOnly' },
        { sid: 'APPLICATION PACKAGE AUTHORITY\\ALL APPLICATION PACKAGES', type: 'Allow',
            rights: 131097, propagation: 'None' },
        { sid: 'S-1-15-3-1024-1065365936-1281604716-3511738428-1654721687-432734479-3232135806-4053264122-3456934681',
            type: 'Allow', rights: 131097, propagation: 'None' }
    ]
});

test('protected policy accepts inherited CREATOR OWNER on children while current token cannot write', () => {
    assert.equal(operatorAclSafe({ currentTokenCanWrite: false, records: [record(), record()] }), true);
});

test('protected policy rejects effective CREATOR OWNER or ordinary-user write grants', () => {
    const effective = record();
    effective.aces[3].propagation = 'None';
    assert.equal(operatorAclSafe({ currentTokenCanWrite: false, records: [effective, record()] }), false);
    const userWriter = record();
    userWriter.aces[0].rights = 983103;
    assert.equal(operatorAclSafe({ currentTokenCanWrite: false, records: [userWriter, record()] }), false);
    const unresolvedWriter = record();
    unresolvedWriter.aces[4].rights = 983103;
    assert.equal(operatorAclSafe({ currentTokenCanWrite: false, records: [unresolvedWriter, record()] }), false);
});
