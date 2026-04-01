import { useState } from 'react';

const C = {
  elevated: '#181818',
  green: '#1ed760',
  textPrimary: '#fff',
  textSecondary: '#a7a7a7',
};

export default function AlbumCard({ album, onClick, compact }) {
  const [hovered, setHovered] = useState(false);
  const hasCover = !!album.cover;
  const songCount = (album.song_ids || []).length;

  if (compact) {
    return (
      <div onClick={onClick} className="cursor-pointer" style={{ WebkitTapHighlightColor: 'transparent' }}>
        <div
          className="rounded-md overflow-hidden"
          style={{
            width: '100%',
            paddingBottom: '100%',
            position: 'relative',
            background: hasCover
              ? `url('${album.cover}') center/cover no-repeat`
              : 'linear-gradient(135deg, #404040, #282828)',
            boxShadow: '0 4px 12px rgba(0,0,0,.4)',
          }}
        >
          {!hasCover && (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg viewBox="0 0 80 80" width={32} height={32} fill="none" opacity={0.15}>
                <path d="M25 60V20l35 20-35 20z" fill="#fff" />
              </svg>
            </div>
          )}
        </div>
        <div className="font-semibold truncate mt-2" style={{ fontSize: 12, color: C.textPrimary, lineHeight: 1.3 }}>
          {album.name}
        </div>
        <div className="truncate" style={{ fontSize: 11, color: C.textSecondary, lineHeight: 1.3, marginTop: 1 }}>
          {songCount} song{songCount !== 1 ? 's' : ''}
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="cursor-pointer rounded-lg transition-colors duration-300"
      style={{
        padding: 12,
        background: hovered ? '#282828' : C.elevated,
      }}
    >
      {/* Square cover image */}
      <div className="relative mb-3" style={{ paddingBottom: '100%' }}>
        <div
          className="absolute inset-0 rounded overflow-hidden"
          style={{
            background: hasCover
              ? `url('${album.cover}') center/cover no-repeat`
              : 'linear-gradient(135deg, #404040, #282828)',
            boxShadow: '0 8px 24px rgba(0,0,0,.5)',
          }}
        >
          {!hasCover && (
            <div className="w-full h-full flex items-center justify-center">
              <svg viewBox="0 0 80 80" width={48} height={48} fill="none" opacity={0.15}>
                <path d="M25 60V20l35 20-35 20z" fill="#fff" />
              </svg>
            </div>
          )}
        </div>

        {/* Spotify green play button */}
        <button
          className="absolute bottom-2 right-2 flex items-center justify-center rounded-full shadow-xl transition-all duration-300"
          style={{
            width: 44,
            height: 44,
            background: C.green,
            opacity: hovered ? 1 : 0,
            transform: hovered ? 'translateY(0)' : 'translateY(8px)',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 8px 16px rgba(0,0,0,.3)',
          }}
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          aria-label={`Play ${album.name}`}
        >
          <svg viewBox="0 0 24 24" fill="black" width={18} height={18} style={{ marginLeft: 2 }}>
            <polygon points="5,3 19,12 5,21" />
          </svg>
        </button>
      </div>

      {/* Title */}
      <div
        className="font-bold truncate"
        style={{ fontSize: 14, color: C.textPrimary, lineHeight: 1.3 }}
      >
        {album.name}
      </div>
      {/* Subtitle */}
      <div
        className="mt-0.5"
        style={{
          fontSize: 12,
          color: C.textSecondary,
          lineHeight: 1.3,
        }}
      >
        {songCount} song{songCount !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
