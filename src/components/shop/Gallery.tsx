"use client";
import { useState } from "react";

/** Main image + thumbnails on desktop; swipeable strip on mobile. */
export function Gallery({ images, title, placeholder }: { images: string[]; title: string; placeholder: string }) {
  const [active, setActive] = useState(0);
  if (!images.length) {
    return <div className="shop-display grid aspect-[4/5] place-items-center bg-[var(--surface-2)] p-8 text-center text-5xl text-[var(--ink-3)]">{placeholder}</div>;
  }
  return (
    <div>
      <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto sm:hidden" aria-label={`${title} photos`}>
        {images.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt={i === 0 ? title : `${title} — photo ${i + 1}`} className="aspect-[4/5] w-[88%] shrink-0 snap-center bg-[var(--surface-2)] object-cover" loading={i === 0 ? "eager" : "lazy"} />
        ))}
      </div>
      <div className="hidden gap-3 sm:grid sm:grid-cols-[72px_1fr]">
        <div className="flex flex-col gap-2">
          {images.map((src, i) => (
            <button key={src} onClick={() => setActive(i)} aria-label={`Show photo ${i + 1}`} aria-current={i === active}
              className={`aspect-square overflow-hidden bg-[var(--surface-2)] ${i === active ? "ring-2 ring-[var(--ink)]" : "opacity-70 hover:opacity-100"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[active]} alt={title} className="aspect-[4/5] w-full bg-[var(--surface-2)] object-cover" />
      </div>
    </div>
  );
}
