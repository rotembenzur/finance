// ─────────────────────────────────────────────────────────────────
//  CARD IMAGE STORAGE — custom card-face photos live in Supabase Storage
//
//  Bucket: `card-images` (private). The path layout is
//  `<cardId>/<random>-<filename>` — one folder per card so deleting a
//  card cleans up its image in a single prefix remove. Storage policies
//  require an authenticated session (mirror the `voucher-attachments`
//  bucket setup — see SECURITY_SETUP.md).
//
//  The card record stores ONLY the Storage path in `card.image` (e.g.
//  `<cardId>/abc123-front.jpg`). A short-lived signed URL is minted on
//  demand when the wallet renders the card face — never persisted, so a
//  leaked record JSON can't be used to fetch the image without auth.
//
//  Demo mode (`?v_display`): zero Storage I/O. Uploads encode the file
//  inline as a data URI so the UI can still preview it; fetches pass the
//  data URI through unchanged; deletes are silent no-ops. See
//  [[demo-mode]].
//
//  This mirrors js/voucher-storage.js — kept as a separate module so the
//  voucher and card paths stay independent (different bucket, different
//  validation: images only, no PDFs).
// ─────────────────────────────────────────────────────────────────

import { supabase } from './supabase.js';
import { isDemoMode } from './demo-mode.js';

const BUCKET = 'card-images';
const SIGNED_URL_TTL_SECONDS = 60 * 60;          // 1 hour view window
const MAX_BYTES              = 5 * 1024 * 1024;  // 5 MB hard cap
const ALLOWED_PREFIX         = 'image/';

export class CardImageError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// True when `image` is a Supabase Storage path (vs an inline data URI or
// a plain http(s) URL). Demo placeholders use `data:`; legacy/manual
// values may be absolute URLs — neither is signed.
export function isStoragePath(ref) {
  return typeof ref === 'string'
    && ref.length > 0
    && !ref.startsWith('data:')
    && !/^https?:\/\//i.test(ref);
}

// Upload a File/Blob to `card-images/<cardId>/<random>-<name>`. Returns
// the storage path on success; throws CardImageError on validation
// failure or storage error. Demo mode short-circuits with a data URI so
// the public path never hits Supabase.
export async function uploadCardImage(cardId, file) {
  if (!file) throw new CardImageError('no_file', 'No file selected.');
  if (!cardId) throw new CardImageError('no_card', 'Missing card id.');

  if (file.size > MAX_BYTES) {
    throw new CardImageError('too_large',
      `Image is ${(file.size / 1024 / 1024).toFixed(1)}MB — limit is 5MB.`);
  }
  if (!(file.type || '').startsWith(ALLOWED_PREFIX)) {
    throw new CardImageError('bad_type',
      `Only images are accepted. Got "${file.type || 'unknown'}".`);
  }

  // Demo path: encode inline as a data URI so the UI can still show a
  // preview. Never hits the network. isStoragePath() returns false on
  // it, so getCardImageURL() skips signing.
  if (isDemoMode()) {
    return await _fileToDataURI(file);
  }

  const safeName = _safeFilename(file.name || 'card.jpg');
  const rand     = Math.random().toString(36).slice(2, 9);
  const path     = `${cardId}/${rand}-${safeName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert:      false,
  });
  if (error) {
    throw new CardImageError('upload_failed',
      `Storage upload failed: ${error.message || error.statusCode || 'unknown'}`);
  }

  return path;
}

// Get a short-lived signed URL for displaying the card image. Data URIs
// (demo) and plain http(s) URLs (legacy/manual) pass through unchanged.
// Storage paths are signed against the bucket. Returns null on failure
// rather than throwing, since the call site uses it to decide whether to
// swap in the <img> src.
export async function getCardImageURL(ref) {
  if (!ref) return null;
  if (!isStoragePath(ref)) return ref;          // data:... or https://...
  if (isDemoMode()) return null;                // shouldn't happen — demo uses data URIs

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(ref, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      console.warn('[card-image-storage] signed URL failed', error);
      return null;
    }
    return data.signedUrl;
  } catch (e) {
    console.warn('[card-image-storage] signed URL threw', e);
    return null;
  }
}

// Remove a card image from Storage. Silent on missing files / demo-mode /
// non-storage refs — used in cleanup paths where failure is non-fatal
// (we'd rather leak a file than block the user from deleting their card).
export async function deleteCardImage(ref) {
  if (!ref || !isStoragePath(ref) || isDemoMode()) return;
  try {
    await supabase.storage.from(BUCKET).remove([ref]);
  } catch (e) {
    console.warn('[card-image-storage] delete threw', e);
  }
}

// Sanitize a user-supplied filename. Keep ASCII letters, digits, dot,
// dash, underscore — replace everything else with '-'. Truncated to
// 80 chars to keep the storage path reasonable.
function _safeFilename(name) {
  const cleaned = String(name).normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-');
  return cleaned.slice(0, 80) || 'card.jpg';
}

function _fileToDataURI(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new CardImageError('read_failed',
      'Could not read the file.'));
    reader.readAsDataURL(file);
  });
}
