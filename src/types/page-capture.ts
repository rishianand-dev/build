export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputedStyleSnapshot {
  display: string;
  position: string;
  top: string;
  left: string;
  right: string;
  bottom: string;
  zIndex: string;
  overflow: string;
  opacity: string;
  visibility: string;
  transform: string;
  backgroundColor: string;
  backgroundImage: string;
  color: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  textAlign: string;
  padding: string;
  margin: string;
  borderRadius: string;
  boxShadow: string;
  flexDirection: string;
  justifyContent: string;
  alignItems: string;
  gap: string;
  gridTemplateColumns: string;
}

export interface DomNode {
  tag: string;
  id: string;
  className: string;
  role: string | null;
  ariaLabel: string | null;
  /**
   * Semantic data-* attributes (data-testid, data-component, data-section-type,
   * etc.) — an allowlist, not every data-* on the element, since frameworks
   * dump non-semantic noise there too (Vue's data-v-hash, React devtools ids).
   */
  dataAttrs?: Record<string, string>;
  href?: string;
  src?: string;
  srcset?: string;
  poster?: string;
  alt?: string;
  type?: string;
  placeholder?: string;
  text: string;
  box: Box;
  style: ComputedStyleSnapshot;
  children: DomNode[];
}

export interface AssetRef {
  url: string;
  content_type: string | null;
  resource_type: "image" | "font" | "stylesheet" | "script" | "other";
}

export interface ScreenshotPaths {
  full_page: string;
  viewport_top: string;
  scroll_600: string;
  scroll_back: string;
  hovers: Array<{
    index: number;
    selector: string;
    before: string;
    after: string;
  }>;
}

export interface HeaderProbe {
  selector: string;
  tag: string;
  className: string;
  computed_position: string;
  computed_transform: string;
  box_top: Box | null;
  box_scrolled: Box | null;
  box_back: Box | null;
  visible_top: boolean;
  visible_scrolled: boolean;
  visible_back: boolean;
}

export interface HeaderBehavior {
  /** Source header stayed in the viewport after scrolling 600px. */
  sticky_or_fixed: boolean;
  /**
   * Maps to builder `lock_height_enable`: header stays fully visible
   * (position fixed / sticky, not hidden by transform) while scrolled.
   */
  lock_height_enable: boolean;
  /**
   * Header is position:fixed and remained at y≈0 after scroll.
   * Brief name: always_fixed_on_scroll.
   */
  always_fixed_on_scroll: boolean;
  /**
   * Header hid after scrolling down and returned after scrolling back.
   * Distinguishes JS hide-on-scroll from a normal in-flow header.
   */
  reappear_on_scroll_up: boolean;
  /** In-flow (not sticky/fixed) — scrolled out of view naturally. */
  document_flow: boolean;
  confidence: number;
  evidence: string[];
  probe: HeaderProbe | null;
}

export interface HoverLink {
  href: string;
  label: string;
}

export interface HoverReveal {
  index: number;
  selector: string;
  kind: "card" | "nav";
  box: Box;
  text_preview: string;
  before_html_hash: string;
  after_html_hash: string;
  revealed: boolean;
  added_text: string;
  added_images: string[];
  added_links: HoverLink[];
  evidence: string[];
}

export interface CandidateBlock {
  index: number;
  selector: string;
  tag: string;
  role: string | null;
  className: string;
  id: string;
  box: Box;
  gap_before_px: number;
  text_preview: string;
  html_snippet: string;
  image_count: number;
  link_count: number;
  repeated_sibling_count: number;
  landmark: boolean;
}

export interface ThemeHints {
  background_color: string;
  text_color: string;
  fonts: string[];
  color_palette: string[];
  css_variables: Record<string, string>;
}

export interface PageCapture {
  schema_version: "1.0";
  url: string;
  final_url: string;
  captured_at: string;
  title: string;
  viewport: { width: number; height: number };
  page_metrics: { scroll_width: number; scroll_height: number };
  seo: {
    description: string | null;
    canonical: string | null;
    og_title: string | null;
    og_description: string | null;
    og_image: string | null;
  };
  screenshots: ScreenshotPaths;
  assets: AssetRef[];
  theme_hints: ThemeHints;
  header_behavior: HeaderBehavior;
  hover_reveals: HoverReveal[];
  candidate_blocks: CandidateBlock[];
  /** Simplified visible DOM with computed styles. Later phases read this. */
  dom: DomNode | null;
  warnings: string[];
}
