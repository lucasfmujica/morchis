// Lightweight loading skeleton shown instantly during route transitions
// (via each route's loading.tsx Suspense boundary), so navigation feels snappy
// even while the server fetches the profile.
export function PageSkeleton({ title }: { title?: string }) {
  return (
    <div className="min-h-screen pb-24" style={{ background: '#F1F5F3' }}>
      <header className="px-5 pt-14 pb-4">
        {title ? (
          <h1 className="text-2xl font-black" style={{ color: '#18211D' }}>{title}</h1>
        ) : (
          <div className="h-7 w-40 rounded-lg skeleton" />
        )}
      </header>
      <div className="px-4 flex flex-col gap-4">
        {/* hero card */}
        <div className="rounded-3xl skeleton" style={{ height: 132 }} />
        {/* chip row */}
        <div className="flex gap-2">
          {[64, 88, 72, 80].map((w, i) => (
            <div key={i} className="h-8 rounded-full skeleton" style={{ width: w }} />
          ))}
        </div>
        {/* list rows */}
        <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3.5"
              style={{ borderTop: i > 0 ? '1px solid #EAF0ED' : 'none' }}
            >
              <div className="w-9 h-9 rounded-full skeleton shrink-0" />
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <div className="h-3.5 rounded skeleton" style={{ width: '55%' }} />
                <div className="h-2.5 rounded skeleton" style={{ width: '35%' }} />
              </div>
              <div className="h-6 w-16 rounded-full skeleton shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
