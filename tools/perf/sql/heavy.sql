-- SPDX-License-Identifier: AGPL-3.0-only
SET session_replication_role = replica;
INSERT INTO artifacts (id, storage_account_id, pouch_id, name_index, head_revision_id)
SELECT md5('ha'||a)::uuid, md5('sa777')::uuid, md5('p777-1')::uuid, decode(md5('hn'||a),'hex'), md5('hr'||a||'-2')::uuid FROM generate_series(1,3000) a;
INSERT INTO revisions (id, storage_account_id, pouch_id, artifact_id, parent_id, envelope, envelope_hash, signature, signer_member_id, key_gen, stored_size, author_user_id, origin, created_at, expires_at)
SELECT md5('hr'||a||'-'||v)::uuid, md5('sa777')::uuid, md5('p777-1')::uuid, md5('ha'||a)::uuid, CASE WHEN v=2 THEN md5('hr'||a||'-1')::uuid END, repeat('x',300)::bytea, '\x00','\x00', md5('m777-1')::uuid,1,2000,'u777','web', now()-(v||' days')::interval, CASE WHEN v=1 THEN now()+interval '10 days' END
FROM generate_series(1,3000) a, generate_series(1,2) v;
INSERT INTO blobs (storage_account_id, pouch_id, blob_id, ciphertext_hash, stored_size, key_gen, ref_count, state)
SELECT md5('sa777')::uuid, md5('p777-1')::uuid, decode(md5('hb'||a||v||f),'hex'), '\x00', 2000, 1, 1, 'stored' FROM generate_series(1,3000) a, generate_series(1,2) v, generate_series(1,2) f;
INSERT INTO revision_blobs (storage_account_id, pouch_id, revision_id, blob_id)
SELECT md5('sa777')::uuid, md5('p777-1')::uuid, md5('hr'||a||'-'||v)::uuid, decode(md5('hb'||a||v||f),'hex') FROM generate_series(1,3000) a, generate_series(1,2) v, generate_series(1,2) f;
SET session_replication_role = origin;
ANALYZE artifacts, revisions, blobs, revision_blobs;
