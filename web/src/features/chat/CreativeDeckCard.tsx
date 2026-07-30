type DeckAsset = {
  assetId: string;
  downloadName: string;
  slideCount: number;
  creditsCharged: number;
  previewUrl?: string | null;
  downloadUrl?: string | null;
};

type Props = {
  asset: DeckAsset;
};

/** Inline artefact card for a finished slide deck (Phase B5). */
export function CreativeDeckCard({ asset }: Props) {
  return (
    <div className="mt-3 max-w-lg overflow-hidden rounded-[var(--radius-surface)] border border-line bg-raised/60">
      {asset.previewUrl ? (
        <img
          src={asset.previewUrl}
          alt={`Preview of ${asset.downloadName}`}
          className="block w-full border-b border-line/60"
        />
      ) : (
        <div className="grid h-28 place-items-center border-b border-line/60 bg-ink/40 font-mono text-[11px] text-mist">
          {asset.slideCount} slides · preview pending
        </div>
      )}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-paper">
            {asset.downloadName}
          </p>
          <p className="font-mono text-[11px] text-mist">
            {asset.slideCount} slides · {asset.creditsCharged} credits
          </p>
        </div>
        {asset.downloadUrl && (
          <a
            href={asset.downloadUrl}
            download={asset.downloadName}
            className="interactive shrink-0 rounded-[var(--radius-control)] border border-signal/40 bg-signal/15 px-3 py-1.5 text-[12px] font-semibold text-signal hover:bg-signal/25"
          >
            Download
          </a>
        )}
      </div>
    </div>
  );
}
