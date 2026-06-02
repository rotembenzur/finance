// ─────────────────────────────────────────────────────────────────
//  LOGO STORAGE — uploaded institution logos live in Supabase Storage
//
//  Bucket: `institution-logos` (PUBLIC). Logos are non-sensitive brand
//  marks rendered via plain <img src> in many places (the picker, the
//  provider grid, account headers, deposit rows). A public bucket lets us
//  store the resulting public URL directly in `provider.logo` (or any
//  hasLogo record) so every existing renderer just works — no signed-URL
//  resolution, unlike the private card-images bucket.
//
//  Library logos (assets/logos/…) and previously-uploaded URLs stay
//  selectable in the picker; this only handles NEW uploads.
//
//  Demo mode (`?v_display`): zero Storage I/O — the file is encoded
//  inline as a data URI so the preview still works; never hits Supabase.
// ─────────────────────────────────────────────────────────────────

import { supabase } from './supabase.js';
import { isDemoMode } from './demo-mode.js';

const BUCKET         = 'institution-logos';
const MAX_BYTES      = 2 * 1024 * 1024;   // 2 MB — logos are small
const ALLOWED_PREFIX = 'image/';

export class LogoUploadError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Upload an image and return a URL to store in <record>.logo. Public URL
// for real uploads; an inline data URI in demo mode. Throws
// LogoUploadError on validation / storage failure.
export async function uploadInstitutionLogo(file) {
  if (!file) throw new LogoUploadError('no_file', 'No file selected.');
  if (file.size > MAX_BYTES) {
    throw new LogoUploadError('too_large',
      `Image is ${(file.size / 1024 / 1024).toFixed(1)}MB — limit is 2MB.`);
  }
  if (!(file.type || '').startsWith(ALLOWED_PREFIX)) {
    throw new LogoUploadError('bad_type',
      `Only images are accepted. Got "${file.type || 'unknown'}".`);
  }

  if (isDemoMode()) return await _fileToDataURI(file);

  const safeName = _safeFilename(file.name || 'logo');
  const rand     = Math.random().toString(36).slice(2, 9);
  const path     = `${rand}-${safeName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert:      false,
  });
  if (error) {
    throw new LogoUploadError('upload_failed',
      `Storage upload failed: ${error.message || error.statusCode || 'unknown'}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data || !data.publicUrl) {
    throw new LogoUploadError('no_url', 'Upload succeeded but no public URL was returned.');
  }
  return data.publicUrl;
}

// True when a logo value is an uploaded image (public URL or demo data
// URI) rather than a bundled asset path — used by the picker to surface
// previously-uploaded logos for reuse.
export function isUploadedLogo(value) {
  return typeof value === 'string' && /^(https?:|data:)/.test(value);
}

function _safeFilename(name) {
  const cleaned = String(name).normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-');
  return cleaned.slice(0, 80) || 'logo';
}

function _fileToDataURI(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new LogoUploadError('read_failed', 'Could not read the file.'));
    reader.readAsDataURL(file);
  });
}
