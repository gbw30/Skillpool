// The app's icons: 24-unit grid, drawn with the text colour, sized in em by default.
import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;

function Icon(props: Props) {
  return (
    <svg
      width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}
    />
  );
}

export const Moon = (p: Props) => <Icon {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></Icon>;
export const Sun = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);
export const Monitor = (p: Props) => <Icon {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Icon>;
export const Exit = (p: Props) => <Icon {...p}><path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 8l4 4-4 4M19 12H10" /></Icon>;
export const Search = (p: Props) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>;
export const ArrowUpRight = (p: Props) => <Icon {...p}><path d="M7 17 17 7M8 7h9v9" /></Icon>;
export const Alert = (p: Props) => (
  <Icon {...p}>
    <path d="M10.3 3.9 2.4 17.5a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </Icon>
);

export const Plus = (p: Props) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const Minus = (p: Props) => <Icon {...p}><path d="M5 12h14" /></Icon>;
export const Upload = (p: Props) => <Icon {...p}><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></Icon>;
export const Folder = (p: Props) => <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></Icon>;
export const Check = (p: Props) => <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;

/** The SkillPool mark: one node linked to two. */
export const Logo = (p: Props) => (
  <Icon strokeWidth={2} {...p}>
    <path d="M8 12h3c3 0 2-6 5-6M11 12c3 0 2 6 5 6" />
    <circle cx="5.5" cy="12" r="2.5" /><circle cx="18.5" cy="6" r="2.5" /><circle cx="18.5" cy="18" r="2.5" />
  </Icon>
);
