import React from 'react';

function SkeletonBlock({ width, height, borderRadius = 'var(--radius)' }) {
  return (
    <div style={{
      width, height, borderRadius,
      background: 'linear-gradient(90deg, var(--bg-2) 0%, var(--bg-3) 40%, var(--bg-2) 80%)',
      backgroundSize: '400px 100%',
      animation: 'shimmer 1.6s ease-in-out infinite',
      opacity: 0.6,
    }} />
  );
}

function SkeletonCircle({ size }) {
  return <SkeletonBlock width={size} height={size} borderRadius="50%" />;
}

function SkeletonLine({ width = '100%', height = 12 }) {
  return <SkeletonBlock width={width} height={height} />;
}

export function DashboardSkeleton() {
  return (
    <div>
      {/* title area */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <SkeletonLine width={120} height={10} />
          <div style={{ marginTop: 6 }}><SkeletonLine width={200} height={22} /></div>
          <div style={{ marginTop: 6 }}><SkeletonLine width={260} height={12} /></div>
        </div>
        <SkeletonBlock width={80} height={30} borderRadius={999} />
      </div>

      {/* Org strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 1, marginBottom: 20 }}>
        {[...Array(7)].map((_, i) => (
          <div key={i} style={{ padding: '12px 14px' }}>
            <SkeletonLine width={60} height={10} />
            <div style={{ marginTop: 8 }}><SkeletonLine width={80} height={24} /></div>
          </div>
        ))}
      </div>

      {/* Team table header */}
      <div style={{ padding: '10px 14px', marginBottom: 1 }}>
        <SkeletonLine width={140} height={14} />
      </div>

      {/* Table rows */}
      {[...Array(4)].map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 14, padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
          <SkeletonCircle size={26} />
          <SkeletonLine width={120} height={13} />
          <div style={{ flex: 1 }} />
          <SkeletonLine width={60} height={13} />
          <SkeletonLine width={60} height={13} />
          <SkeletonLine width={60} height={13} />
          <SkeletonLine width={60} height={13} />
          <SkeletonLine width={60} height={13} />
        </div>
      ))}
    </div>
  );
}

export function ProfilesSkeleton() {
  return (
    <div>
      <SkeletonLine width={200} height={24} style={{ marginBottom: 18 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card" style={{ padding: 18, borderLeft: '3px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
              <SkeletonLine width={100} height={18} />
              <SkeletonBlock width={60} height={20} borderRadius={999} />
            </div>
            <SkeletonLine width={180} height={12} />
            <div style={{ marginTop: 8 }}><SkeletonLine width="90%" height={12} /></div>
            <div style={{ marginTop: 6 }}><SkeletonLine width="70%" height={12} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ModelDetailSkeleton() {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <SkeletonCircle size={56} />
        <div style={{ flex: 1 }}>
          <SkeletonLine width={100} height={10} />
          <div style={{ marginTop: 4 }}><SkeletonLine width={160} height={24} /></div>
          <div style={{ marginTop: 6 }}><SkeletonLine width={280} height={12} /></div>
        </div>
        <SkeletonBlock width={90} height={36} borderRadius={999} />
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18 }}>
        <SkeletonBlock width={120} height={32} borderRadius="6px 6px 0 0" />
        <SkeletonBlock width={100} height={32} borderRadius="6px 6px 0 0" />
        <SkeletonBlock width={90} height={32} borderRadius="6px 6px 0 0" />
        <div style={{ flex: 1 }} />
        <SkeletonBlock width={140} height={32} borderRadius={999} />
      </div>

      {/* Account rows */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <SkeletonCircle size={20} />
          <SkeletonLine width={140} height={18} />
        </div>
        {[...Array(3)].map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 6, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <SkeletonBlock width={36} height={36} borderRadius="50%" />
            <div style={{ flex: 1 }}>
              <SkeletonLine width={160} height={14} />
              <div style={{ marginTop: 4 }}><SkeletonLine width={100} height={11} /></div>
            </div>
            <SkeletonBlock width={110} height={26} borderRadius={6} />
            <SkeletonBlock width={60} height={26} borderRadius={6} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function InboxSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 220px) minmax(260px, 340px) 1fr', gap: 1, border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', minHeight: 500 }}>
      {/* Left column — accounts */}
      <div style={{ padding: 12, background: 'var(--bg-0)' }}>
        {[...Array(4)].map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
            <SkeletonCircle size={30} />
            <div style={{ flex: 1 }}>
              <SkeletonLine width={90} height={13} />
              <div style={{ marginTop: 4 }}><SkeletonLine width={50} height={10} /></div>
            </div>
          </div>
        ))}
      </div>

      {/* Middle column — conversation list */}
      <div style={{ padding: 12, background: 'var(--bg-elev)' }}>
        <SkeletonBlock width="100%" height={80} borderRadius={10} />
        <div style={{ marginTop: 12 }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 8px' }}>
              <SkeletonCircle size={30} />
              <div style={{ flex: 1 }}>
                <SkeletonLine width={120} height={13} />
                <div style={{ marginTop: 4 }}><SkeletonLine width="90%" height={11} /></div>
                <div style={{ marginTop: 3 }}><SkeletonLine width={60} height={10} /></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right column — thread */}
      <div style={{ padding: 20, background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        {[...Array(3)].map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 16, justifyContent: i % 2 === 0 ? 'flex-start' : 'flex-end' }}>
            {i % 2 === 0 && <SkeletonCircle size={24} />}
            <SkeletonBlock width={200} height={40} borderRadius={14} />
            {i % 2 !== 0 && <SkeletonCircle size={24} />}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div>
      <SkeletonLine width={200} height={24} style={{ marginBottom: 18 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 22 }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="card" style={{ padding: '14px 16px' }}>
            <SkeletonLine width={70} height={10} />
            <div style={{ marginTop: 6 }}><SkeletonLine width={60} height={24} /></div>
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <SkeletonLine width={160} height={16} />
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: 14, padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
            <SkeletonLine width={120} height={13} />
            <SkeletonLine width={80} height={13} />
            <SkeletonLine width={60} height={13} />
            <SkeletonLine width={60} height={13} />
            <SkeletonLine width={60} height={13} />
            <SkeletonLine width={60} height={13} />
            <SkeletonLine width={80} height={13} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div>
      <SkeletonLine width={200} height={24} style={{ marginBottom: 18 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 18 }}>
        <div className="card" style={{ padding: 12 }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} style={{ padding: '8px 10px' }}>
              <SkeletonLine width={120} height={13} />
            </div>
          ))}
        </div>
        <div>
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card" style={{ marginBottom: 14 }}>
              <SkeletonLine width={140} height={16} />
              <div style={{ marginTop: 12 }}>
                <SkeletonLine width="100%" height={36} />
              </div>
              <div style={{ marginTop: 8 }}>
                <SkeletonLine width="100%" height={36} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function GenericPageSkeleton() {
  return (
    <div>
      <SkeletonLine width={200} height={24} style={{ marginBottom: 18 }} />
      <div className="card" style={{ padding: 24 }}>
        <SkeletonLine width="40%" height={16} />
        <div style={{ marginTop: 12 }}><SkeletonLine width="100%" height={12} /></div>
        <div style={{ marginTop: 6 }}><SkeletonLine width="90%" height={12} /></div>
        <div style={{ marginTop: 6 }}><SkeletonLine width="70%" height={12} /></div>
        <div style={{ marginTop: 18 }}><SkeletonLine width="60%" height={16} /></div>
        <div style={{ marginTop: 12 }}><SkeletonLine width="100%" height={36} /></div>
        <div style={{ marginTop: 8 }}><SkeletonLine width="100%" height={36} /></div>
      </div>
    </div>
  );
}
