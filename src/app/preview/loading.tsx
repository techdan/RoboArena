export default function PreviewLoading() {
  return (
    <main className="min-h-screen bg-[#0d100e] px-8 py-10 text-white">
      <div className="mx-auto max-w-[1280px] animate-pulse">
        <div className="h-4 w-48 rounded bg-white/10" />
        <div className="mt-6 h-24 w-[34rem] max-w-full rounded-2xl bg-white/8" />
        <div className="mt-10 grid grid-cols-2 gap-6">
          <div className="h-[38rem] rounded-3xl bg-white/5" />
          <div className="h-[44rem] rounded-3xl bg-white/5" />
        </div>
      </div>
    </main>
  );
}
