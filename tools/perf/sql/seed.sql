-- SPDX-License-Identifier: AGPL-3.0-only
-- Synthetic load: 20k accounts, 40k pouches, 400k artifacts, 800k revisions/blobs/events.
SET session_replication_role = replica; -- skip FK checks while bulk loading
\set N 20000
INSERT INTO users (id, name, email, email_verified)
SELECT 'u'||g, 'user'||g, 'user'||g||'@x.test', true FROM generate_series(1,:N) g;
INSERT INTO storage_accounts (id, owner_user_id, entitlements, quota_bytes, used_bytes, genesis_hash, roster_seq)
SELECT md5('sa'||g)::uuid, 'u'||g, '{"plan_slug":"free","pouch_limit":1,"storage_bytes":104857600}', 104857600, 50000, '\x00', 5
FROM generate_series(1,:N) g;
INSERT INTO pouches (id, storage_account_id, created_seq, epoch, event_seq, state)
SELECT md5('p'||g||'-'||k)::uuid, md5('sa'||g)::uuid, k, md5('e'||g||k)::uuid, 20, CASE WHEN k=2 AND g%3=0 THEN 'locked' ELSE 'active' END
FROM generate_series(1,:N) g, generate_series(1,2) k;
INSERT INTO devices (id, storage_account_id, user_id, name, os, arch, cli_version, refresh_hash, refresh_family_id, last_seen_at)
SELECT md5('d'||g)::uuid, md5('sa'||g)::uuid, 'u'||g, 'laptop', 'linux', 'x86_64', '0.1.0', '\x00', md5('f'||g)::uuid, now()
FROM generate_series(1,:N) g;
INSERT INTO device_keys (storage_account_id, device_id, jkt, public_jwk, key_storage)
SELECT md5('sa'||g)::uuid, md5('d'||g)::uuid, 'jkt'||g, '{}', 'file' FROM generate_series(1,:N) g;
INSERT INTO account_members (id, storage_account_id, kind, device_id, session_jkt, sign_pub, enc_pub, added_seq, last_seen_at)
SELECT md5('m'||g||'-'||k)::uuid, md5('sa'||g)::uuid,
  (ARRAY['browser','password','recovery','device'])[k],
  CASE WHEN k=4 THEN md5('d'||g)::uuid END,
  CASE WHEN k=1 THEN 'sjkt'||g END, '{}', '{}', k, now()
FROM generate_series(1,:N) g, generate_series(1,4) k;
INSERT INTO sessions (id, token, user_id, expires_at, jkt, step_up_at)
SELECT 's'||g, 'tok'||g, 'u'||g, now()+interval '7 days', 'sjkt'||g, now() FROM generate_series(1,:N) g;
INSERT INTO roster_statements (storage_account_id, seq, statement, statement_hash, signer_member_id, signature)
SELECT md5('sa'||g)::uuid, s, '\x00', '\x00', md5('m'||g||'-1')::uuid, '\x00' FROM generate_series(1,:N) g, generate_series(0,5) s;
INSERT INTO key_envelopes (storage_account_id, pouch_id, member_id, key_gen, hpke_enc, ciphertext, created_by_member, signature)
SELECT md5('sa'||g)::uuid, md5('p'||g||'-'||k)::uuid, md5('m'||g||'-'||m)::uuid, 1, '\x00', '\x00', md5('m'||g||'-1')::uuid, '\x00'
FROM generate_series(1,:N) g, generate_series(1,2) k, generate_series(1,4) m;
INSERT INTO device_cursors (storage_account_id, device_id, pouch_id, epoch, acked_seq)
SELECT md5('sa'||g)::uuid, md5('d'||g)::uuid, md5('p'||g||'-'||k)::uuid, md5('e'||g||k)::uuid, 20 FROM generate_series(1,:N) g, generate_series(1,2) k;
-- 10 artifacts per pouch, 2 revisions each
INSERT INTO artifacts (id, storage_account_id, pouch_id, name_index, head_revision_id, deleted_at)
SELECT md5('a'||g||'-'||k||'-'||a)::uuid, md5('sa'||g)::uuid, md5('p'||g||'-'||k)::uuid, decode(md5('n'||g||k||a),'hex'),
  md5('r'||g||'-'||k||'-'||a||'-2')::uuid, CASE WHEN a=10 THEN now() END
FROM generate_series(1,:N) g, generate_series(1,2) k, generate_series(1,10) a;
INSERT INTO revisions (id, storage_account_id, pouch_id, artifact_id, parent_id, envelope, envelope_hash, signature, signer_member_id, key_gen, stored_size, author_user_id, origin, created_at, expires_at)
SELECT md5('r'||g||'-'||k||'-'||a||'-'||v)::uuid, md5('sa'||g)::uuid, md5('p'||g||'-'||k)::uuid, md5('a'||g||'-'||k||'-'||a)::uuid,
  CASE WHEN v=2 THEN md5('r'||g||'-'||k||'-'||a||'-1')::uuid END, repeat('x',300)::bytea, '\x00', '\x00', md5('m'||g||'-1')::uuid, 1, 2000, 'u'||g, 'web',
  now() - (v||' days')::interval, CASE WHEN v=1 THEN now() + ((g%60)-30||' days')::interval END
FROM generate_series(1,:N) g, generate_series(1,2) k, generate_series(1,10) a, generate_series(1,2) v;
INSERT INTO blobs (storage_account_id, pouch_id, blob_id, ciphertext_hash, stored_size, key_gen, ref_count, state, unreferenced_since)
SELECT md5('sa'||g)::uuid, md5('p'||g||'-'||k)::uuid, decode(md5('b'||g||k||a||v),'hex'), '\x00', 2000, 1, CASE WHEN g%50=0 AND v=1 THEN 0 ELSE 1 END,
  CASE WHEN g%200=0 AND a=1 THEN 'pending' ELSE 'stored' END, CASE WHEN g%50=0 AND v=1 THEN now()-interval '2 days' END
FROM generate_series(1,:N) g, generate_series(1,2) k, generate_series(1,10) a, generate_series(1,2) v;
INSERT INTO revision_blobs (storage_account_id, pouch_id, revision_id, blob_id)
SELECT md5('sa'||g)::uuid, md5('p'||g||'-'||k)::uuid, md5('r'||g||'-'||k||'-'||a||'-'||v)::uuid, decode(md5('b'||g||k||a||v),'hex')
FROM generate_series(1,:N) g, generate_series(1,2) k, generate_series(1,10) a, generate_series(1,2) v;
INSERT INTO events (storage_account_id, pouch_id, seq, epoch, type, artifact_id, created_at)
SELECT md5('sa'||g)::uuid, md5('p'||g||'-'||k)::uuid, s, md5('e'||g||k)::uuid, 'artifact.updated', md5('a'||g||'-'||k||'-1')::uuid, now() - ((20-s)||' hours')::interval
FROM generate_series(1,:N) g, generate_series(1,2) k, generate_series(1,20) s;
INSERT INTO operation_receipts (storage_account_id, pouch_id, operation_id, request_digest, status, response)
SELECT md5('sa'||g)::uuid, md5('p'||g||'-'||k)::uuid, md5('o'||g||k||s)::uuid, '\x00', 'applied', '{}'
FROM generate_series(1,:N) g, generate_series(1,2) k, generate_series(1,10) s;
INSERT INTO conflicts (id, storage_account_id, pouch_id, artifact_id, type, base_revision_id, server_revision_id, incoming_revision_id, state)
SELECT md5('c'||g)::uuid, md5('sa'||g)::uuid, md5('p'||g||'-1')::uuid, md5('a'||g||'-1-1')::uuid, 'update_update',
  md5('r'||g||'-1-1-1')::uuid, md5('r'||g||'-1-1-2')::uuid, md5('r'||g||'-1-1-2')::uuid, CASE WHEN g%10=0 THEN 'open' ELSE 'resolved' END
FROM generate_series(1,:N) g;
INSERT INTO shares (id, storage_account_id, pouch_id, created_by_member, label_enc, ciphertext, stored_size, expires_at)
SELECT md5('sh'||g)::uuid, md5('sa'||g)::uuid, md5('p'||g||'-1')::uuid, md5('m'||g||'-1')::uuid, '\x00', repeat('y',500)::bytea, 500, now() + ((g%14)-7||' days')::interval
FROM generate_series(1,:N) g;
INSERT INTO security_events (storage_account_id, kind, severity, created_at)
SELECT md5('sa'||g)::uuid, 'cli.authorized', 'info', now() - (s||' days')::interval FROM generate_series(1,:N) g, generate_series(1,3) s;
INSERT INTO audit_log (storage_account_id, actor, action, row_hash, created_at)
SELECT md5('sa'||g)::uuid, 'user', 'x', '\x00', now() - (s||' hours')::interval FROM generate_series(1,:N) g, generate_series(1,10) s;
INSERT INTO bindings (storage_account_id, pouch_id, artifact_id, device_id, payload, key_gen)
SELECT md5('sa'||g)::uuid, md5('p'||g||'-1')::uuid, md5('a'||g||'-1-'||a)::uuid, md5('d'||g)::uuid, '\x00', 1 FROM generate_series(1,:N) g, generate_series(1,10) a;
INSERT INTO cli_auth_requests (id, code_challenge, jkt, sign_pub, enc_pub, key_storage, device_name, os, arch, cli_version, ip_hash, state, expires_at)
SELECT md5('cr'||g)::uuid, '\x00', 'j'||g, '{}', '{}', 'file', 'x', 'linux', 'x', '0', decode(md5('ip'||(g%5000)),'hex'), CASE WHEN g%20=0 THEN 'open' ELSE 'redeemed' END, now() - interval '1 hour' + ((g%20)||' minutes')::interval
FROM generate_series(1,:N) g;
SET session_replication_role = origin;
ANALYZE;
