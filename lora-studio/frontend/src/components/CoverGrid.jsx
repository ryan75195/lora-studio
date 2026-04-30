import { useState, useEffect } from 'react';

function useIsMobile(breakpoint = 769) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

export default function CoverGrid({ images, selectedIndex, onSelect, columns = 3 }) {
  const isMobile = useIsMobile();
  const selected = images[selectedIndex] || null;

  if (isMobile) {
    return (
      <div>
        <div style={{
          width: '100%', aspectRatio: '1', borderRadius: 12, overflow: 'hidden',
          marginBottom: 12, background: '#1a1a1a',
        }}>
          {selected ? (
            <img src={selected.url + '?t=' + Date.now()} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 13 }}>
              Select an image
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
          {images.map((img, i) => (
            <div
              key={i}
              onClick={() => onSelect(i)}
              style={{
                width: 56, height: 56, borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                border: i === selectedIndex ? '2px solid #1ed760' : '2px solid transparent',
                flexShrink: 0, background: '#1a1a1a',
              }}
            >
              {img.url ? (
                <img src={img.url + '?t=' + Date.now()} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 10 }}>!</div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 10 }}>
      {images.map((img, i) => (
        <div
          key={i}
          onClick={() => img.url && onSelect(i)}
          style={{
            aspectRatio: '1', borderRadius: 10, overflow: 'hidden', cursor: img.url ? 'pointer' : 'default',
            border: i === selectedIndex ? '3px solid #1ed760' : '3px solid transparent',
            position: 'relative', background: '#1a1a1a', transition: 'border-color 0.15s',
          }}
        >
          {img.url ? (
            <img src={img.url + '?t=' + Date.now()} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 12 }}>Failed</div>
          )}
          {i === selectedIndex && (
            <div style={{
              position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: '50%',
              background: '#1ed760', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg viewBox="0 0 24 24" fill="#000" style={{ width: 14, height: 14 }}>
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </div>
          )}
          {img.label && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              padding: '4px 8px', background: 'rgba(0,0,0,0.7)',
              fontSize: 11, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {img.label}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
