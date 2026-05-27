// ─────────────────────────────────────────────────────────────────
//  VOUCHER STORAGE — file attachments live in Supabase Storage
//
//  Bucket: `voucher-attachments` (private). The path layout is
//  `<cardId>/<random>-<filename>` — one folder per voucher record so
//  deleting a voucher cleans up all its files in a single prefix
//  remove call. Storage policies require an authenticated session
//  (see SECURITY_SETUP.md / the slice-3 setup walkthrough).
//
//  The voucher record stores ONLY the Storage path (e.g.
//  `<cardId>/abc123-receipt.pdf`). A short-lived signed URL is
//  generated on demand when the user wants to view the file —
//  never persisted, so a leaked record JSON can't be used to fetch
//  the file without auth.
//
//  Demo mode (`?v_display`): zero Storage I/O. The demo dataset
//  ships with inline data-URI placeholders; uploads / fetches /
//  deletes are silent no-ops so the public path never touches the
//  bucket. See [[demo-mode]].
// ─────────────────────────────────────────────────────────────────

import { supabase } from './supabase.js';
import { isDemoMode } from './demo-mode.js';

const BUCKET = 'voucher-attachments';
const SIGNED_URL_TTL_SECONDS = 60 * 60;          // 1 hour view window
const MAX_BYTES              = 5 * 1024 * 1024;  // 5 MB hard cap
const ALLOWED_PREFIXES       = ['image/', 'application/pdf'];

export class VoucherStorageError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// True when the attachment ref is a Supabase Storage path (vs an
// inline data URI). Demo placeholders use `data:` so we don't sign
// them; real uploads use a slash-separated path under the bucket.
export function isStoragePath(ref) {
  return typeof ref === 'string' && ref.length > 0 && !ref.startsWith('data:');
}

// Upload a File/Blob to `voucher-attachments/<cardId>/<random>-<name>`.
// Returns the storage path on success; throws VoucherStorageError on
// validation failure or storage error. Demo mode short-circuits with
// a data-URI so the public path never hits Supabase.
export async function uploadAttachment(cardId, file) {
  if (!file) throw new VoucherStorageError('no_file', 'No file selected.');
  if (!cardId) throw new VoucherStorageError('no_card', 'Missing voucher id.');

  if (file.size > MAX_BYTES) {
    throw new VoucherStorageError('too_large',
      `File is ${(file.size / 1024 / 1024).toFixed(1)}MB — limit is 5MB.`);
  }
  if (!ALLOWED_PREFIXES.some(p => (file.type || '').startsWith(p))) {
    throw new VoucherStorageError('bad_type',
      `Only images and PDFs are accepted. Got "${file.type || 'unknown'}".`);
  }

  // Demo path: encode inline as a data URI so the UI can still show
  // a preview. Never hits the network. The caller stores the data
  // URI in the record, and isStoragePath() returns false on it so
  // viewAttachment() skips signing.
  if (isDemoMode()) {
    return await _fileToDataURI(file);
  }

  const safeName = _safeFilename(file.name || 'file');
  const rand     = Math.random().toString(36).slice(2, 9);
  const path     = `${cardId}/${rand}-${safeName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert:      false,
  });
  if (error) {
    throw new VoucherStorageError('upload_failed',
      `Storage upload failed: ${error.message || error.statusCode || 'unknown'}`);
  }

  return path;
}

// Get a short-lived signed URL for viewing/downloading. Data URIs
// (demo + legacy) pass through unchanged. Storage paths are signed
// against the bucket. Returns null on failure rather than throwing,
// since the call site uses it to decide whether to render a viewer.
export async function getAttachmentURL(ref) {
  if (!ref) return null;
  if (!isStoragePath(ref)) return ref;          // data:image/... or data:application/pdf
  if (isDemoMode()) return null;                // shouldn't happen — demo uses data URIs

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(ref, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      console.warn('[voucher-storage] signed URL failed', error);
      return null;
    }
    return data.signedUrl;
  } catch (e) {
    console.warn('[voucher-storage] signed URL threw', e);
    return null;
  }
}

// Remove an attachment from Storage. Silent on missing files /
// demo-mode / non-storage refs — used in cleanup paths where
// failure is non-fatal (we'd rather leak a file than block the
// user from deleting their voucher record).
export async function deleteAttachment(ref) {
  if (!ref || !isStoragePath(ref) || isDemoMode()) return;
  try {
    await supabase.storage.from(BUCKET).remove([ref]);
  } catch (e) {
    console.warn('[voucher-storage] delete threw', e);
  }
}

// Sanitize a user-supplied filename. Keep ASCII letters, digits,
// dot, dash, underscore — replace everything else with '-'. Long
// names truncated to 80 chars to keep the storage path reasonable.
function _safeFilename(name) {
  const cleaned = String(name).normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-');
  return cleaned.slice(0, 80) || 'file';
}

function _fileToDataURI(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new VoucherStorageError('read_failed',
      'Could not read the file.'));
    reader.readAsDataURL(file);
  });
}
