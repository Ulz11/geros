import PocketBase from "pocketbase";

// In production the app is served BY PocketBase from pb_public, so the API
// lives at the same origin. In dev, talk to the local PocketBase directly.
const url = import.meta.env.DEV ? "http://127.0.0.1:8090" : window.location.origin;

export const pb = new PocketBase(url);
export const PB_URL = url;

// Stable file URL builder - avoids SDK getUrl/getURL naming roulette.
export function fileUrl(collection, record, filename) {
  return `${PB_URL}/api/files/${collection}/${record.id}/${encodeURIComponent(filename)}`;
}

// PocketBase SDK persists auth in localStorage by default - survives reloads.
export function currentUser() {
  // .record on newer SDKs, .model on older ones
  return pb.authStore.record || pb.authStore.model || null;
}

export function userRole() {
  const u = currentUser();
  return u ? u.role : null;
}
