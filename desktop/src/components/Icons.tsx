import type { SVGProps } from "react";

const paths: Record<string, string> = {
  dashboard: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
  flow: "M5 6h6M5 12h10M5 18h6M17 6v12M14 15l3 3 3-3",
  pending: "M7 3h7l4 4v14H7V3Zm7 0v4h4M10 12h5M10 16h5",
  audit: "M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3Zm-2 9 2 2 4-5",
  desk: "M4 7h16v12H4V7Zm3 0V4h10v3M8 12h3M8 16h6",
  docs: "M5 4h9l5 5v11H5V4Zm9 0v5h5M8 13h8M8 17h5",
  sample: "M6 3h12v18H6V3Zm3 5h6M9 12h6M9 16h4",
  policy: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm3 5h8M8 13h8M8 17h5",
  quality: "M4 19V9m5 10V5m5 14v-7m5 7V3",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm5 12 4 4",
  arrow: "M5 12h13m-5-5 5 5-5 5",
  check: "m5 12 4 4L19 6",
  alert: "M12 4l9 16H3L12 4Zm0 6v5m0 3v.5",
  hold: "M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 4v5m0 3v.5",
  sync: "M4 12a8 8 0 0 1 13-6l2 2M20 12a8 8 0 0 1-13 6l-2-2M19 4v4h-4M5 20v-4h4",
  reset: "M4 10a8 8 0 1 1 2 8M4 5v5h5",
  close: "M6 6l12 12M18 6 6 18",
  chevron: "m9 6 6 6-6 6",
  plus: "M12 5v14M5 12h14",
  doc: "M6 3h8l4 4v14H6V3Zm8 0v4h4",
};

export function Icon({ name, size = 18, ...rest }: { name: string; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={paths[name] ?? paths.doc} />
    </svg>
  );
}
