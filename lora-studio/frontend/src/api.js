const BASE = '/api';

async function request(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function get(path) {
  return request(path);
}

function post(path, data) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

function del(path) {
  return request(path, { method: 'DELETE' });
}

// Health
export const getHealth = () => request('/health');

// Artists
export const getArtists = () => request('/artists');
export const createArtist = (data) =>
  request('/artists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
export const getArtist = (slug) => request('/artists/' + slug);
export const deleteArtist = (slug) => request('/artists/' + slug, { method: 'DELETE' });
export const uploadTracks = (slug, files) => {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  return fetch(BASE + '/artists/' + slug + '/upload', { method: 'POST', body: form }).then((r) => {
    if (!r.ok) throw new Error('Upload failed');
    return r.json();
  });
};
export const deleteTrack = (slug, filename) =>
  request('/artists/' + slug + '/tracks/' + encodeURIComponent(filename), { method: 'DELETE' });

// LoRAs
export const getLoras = () => request('/loras');

// Training
export const startTrain = (data) =>
  request('/train', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
export const getTrainStatus = () => request('/train/status');
export const trainStatusSSE = () => new EventSource(BASE + '/train/status');

// AI Build
export const aiBuild = (data) =>
  request('/ai-build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

// AI Playlist (auto-generate entire album)
export const playlistChat = (data) => post('/ai-playlist/chat', data);
export const generatePlaylist = (data) => post('/ai-playlist', data);

// Generate
export const startGenerate = (data) =>
  request('/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
export const getGenerateStatus = () => request('/generate/status');

// Drafts
export const getDraft = (id) => request('/drafts/' + id);
export const getDraftAudioUrl = (id) => BASE + '/drafts/' + id + '/audio';
export const acceptDraft = (id, overwriteId) => {
  const params = overwriteId ? `?overwrite_id=${encodeURIComponent(overwriteId)}` : '';
  return request('/drafts/' + id + '/accept' + params, { method: 'POST' });
};
export const discardDraft = (id) => request('/drafts/' + id + '/discard', { method: 'POST' });
export const repaintDraft = (data) =>
  request('/drafts/repaint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
export const repaintSong = (data) => post('/songs/repaint', data);

// Songs
export const getSongs = () => request('/songs');
export const getSongAudioUrl = (id) => BASE + '/songs/' + encodeURIComponent(id) + '/audio';
export const batchDeleteSongs = (songIds) => post('/songs/batch-delete', { song_ids: songIds });

// Library
export const getLibrary = () => request('/library');
export const createAlbum = (data) =>
  request('/library/albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
export const updateAlbum = (id, data) =>
  request('/library/albums/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
export const deleteAlbum = (id) =>
  request('/library/albums/' + id, { method: 'DELETE' });
export const addSongToAlbum = (albumId, songId) =>
  request('/library/albums/' + albumId + '/songs/' + songId, { method: 'POST' });
export const removeSongFromAlbum = (albumId, songId) =>
  request('/library/albums/' + albumId + '/songs/' + songId, { method: 'DELETE' });
export const describeCover = (albumId, data) =>
  request('/library/albums/' + albumId + '/describe-cover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
export const generateCover = (albumId, data) =>
  request('/library/albums/' + albumId + '/cover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
export const getCoverUrl = (filename) => BASE + '/library/covers/' + filename;

// Favourites
export const updateFavourites = (songIds) =>
  request('/library/favourites', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ song_ids: songIds }),
  });
export const addToFavourites = (songId) =>
  request('/library/favourites/' + encodeURIComponent(songId), { method: 'POST' });
export const removeFromFavourites = (songId) =>
  request('/library/favourites/' + encodeURIComponent(songId), { method: 'DELETE' });

// YouTube Import (playlist → artist tracks)
export const youtubeImport = (slug, data) => post(`/artists/${slug}/youtube-import`, data);
export const youtubeImportStatusSSE = () => new EventSource(BASE + '/youtube-import/status');

// YouTube Upload (album songs → YouTube)
export const getYoutubeAuthUrl = () => get('/youtube/auth-url');
export const youtubeAuthCallback = (data) => post('/youtube/auth-callback', data);
export const getYoutubeAuthStatus = () => get('/youtube/auth-status');
export const youtubeUploadAlbum = (albumId) =>
  request(`/library/albums/${albumId}/youtube-upload`, { method: 'POST' });
export const youtubeUploadStatusSSE = () => new EventSource(BASE + '/youtube-upload/status');
export const youtubeSyncAlbum = (albumId) =>
  request('/library/albums/' + albumId + '/youtube-sync', { method: 'POST' });
export const youtubeSyncStatusSSE = () => new EventSource(BASE + '/youtube-sync/status');

// Queue
export const getQueue = () => get('/queue');
export const cancelJob = (jobId) => del(`/queue/${jobId}`);
export const retryJob = (jobId) => post(`/queue/${jobId}/retry`);
export const clearQueue = () => post('/queue/clear');
export const discardAllReviews = () => post('/queue/discard-all');

// Setup
export const getSetupStatus = () => get('/setup/status');
export const getSetupConfig = () => get('/setup/config');
export const saveSetupConfig = (data) => post('/setup/config', data);
export const checkModels = () => get('/setup/check-models');
export const downloadModels = () => post('/setup/download-models');
export const getDownloadStatus = () => get('/setup/download-status');

// Misc
export const openFolder = () =>
  fetch(BASE + '/open-folder', { method: 'POST' }).catch(() => {});

// Utility
export const fmtTime = (s) => {
  if (!s || isNaN(s)) return '0:00';
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
};

export const fmtDuration = (seconds) => {
  if (!seconds) return '';
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
};
