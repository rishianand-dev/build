import { describe, expect, it } from "vitest";
import { themeFromCapture } from "../src/build/from-capture.js";
import { renderThemeHtml } from "../src/build/render-html.js";
import { cssColorToHex } from "../src/build/color.js";
import { internalNavHref, slugify } from "../src/build/connected-pages.js";
import type { DomNode, PageCapture } from "../src/types/page-capture.js";

function el(partial: Partial<DomNode> & { tag: string }): DomNode {
  return {
    id: "",
    className: "",
    role: null,
    ariaLabel: null,
    text: "",
    box: { x: 0, y: 0, width: 400, height: 80 },
    style: {
      display: "block",
      position: "static",
      top: "auto",
      left: "auto",
      right: "auto",
      bottom: "auto",
      zIndex: "auto",
      overflow: "visible",
      opacity: "1",
      visibility: "visible",
      transform: "none",
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage: "none",
      color: "rgb(0,0,0)",
      fontFamily: "Georgia",
      fontSize: "16px",
      fontWeight: "400",
      lineHeight: "1.4",
      textAlign: "left",
      padding: "0",
      margin: "0",
      borderRadius: "0",
      boxShadow: "none",
      flexDirection: "row",
      justifyContent: "flex-start",
      alignItems: "stretch",
      gap: "0",
      gridTemplateColumns: "none",
    },
    children: [],
    ...partial,
  };
}

describe("cssColorToHex", () => {
  it("converts rgb and skips transparent", () => {
    expect(cssColorToHex("rgb(63, 80, 36)")).toBe("#3f5024");
    expect(cssColorToHex("rgba(0,0,0,0)")).toBeNull();
  });
});

describe("themeFromCapture", () => {
  it("builds header, product list, and renderable HTML", () => {
    const capture: PageCapture = {
      schema_version: "1.0",
      url: "https://shop.example/",
      final_url: "https://shop.example/",
      captured_at: "2026-01-01T00:00:00.000Z",
      title: "Fixture Store",
      viewport: { width: 1440, height: 900 },
      page_metrics: { scroll_width: 1440, scroll_height: 2000 },
      seo: { description: null, canonical: null, og_title: null, og_description: null, og_image: null },
      screenshots: { full_page: "", viewport_top: "", scroll_600: "", scroll_back: "", hovers: [] },
      assets: [],
      theme_hints: {
        background_color: "rgb(250, 246, 238)",
        text_color: "rgb(27, 22, 16)",
        fonts: ["Montserrat"],
        color_palette: ["rgb(63, 80, 36)", "rgb(130, 18, 18)"],
        css_variables: {},
      },
      header_behavior: {
        sticky_or_fixed: true,
        lock_height_enable: true,
        always_fixed_on_scroll: true,
        reappear_on_scroll_up: false,
        document_flow: false,
        confidence: 1,
        evidence: [],
        probe: null,
      },
      hover_reveals: [],
      candidate_blocks: [],
      warnings: [],
      dom: el({
        tag: "body",
        children: [
          el({
            tag: "header",
            children: [
              el({
                tag: "img",
                src: "https://cdn.example/logo.png",
                alt: "Logo",
                box: { x: 0, y: 0, width: 120, height: 40 },
              }),
              el({
                tag: "nav",
                children: [
                  el({
                    tag: "a",
                    href: "https://shop.example/flour",
                    text: "Flour",
                  }),
                ],
              }),
            ],
          }),
          el({
            tag: "main",
            box: { x: 0, y: 80, width: 1440, height: 600 },
            children: [
              el({
                tag: "section",
                className: "collection",
                box: { x: 0, y: 80, width: 1440, height: 400 },
                children: [
                  el({ tag: "h2", text: "~ Best sellers ~" }),
                  el({
                    tag: "div",
                    className: "product-card-wrapper",
                    box: { x: 0, y: 120, width: 220, height: 300 },
                    children: [
                      el({
                        tag: "img",
                        src: "https://cdn.example/p1.jpg",
                        alt: "Atta",
                        box: { x: 0, y: 120, width: 220, height: 220 },
                      }),
                      el({ tag: "h3", text: "MP Premium Atta" }),
                      el({ tag: "span", className: "badge", text: "Save 50%" }),
                      el({ tag: "span", text: "Rs. 600.00" }),
                      el({ tag: "span", text: "Rs. 299.00" }),
                      el({ tag: "button", text: "Add to cart" }),
                      el({ tag: "a", href: "https://shop.example/p1", text: "View" }),
                    ],
                  }),
                  el({
                    tag: "div",
                    className: "product-card-wrapper",
                    box: { x: 240, y: 120, width: 220, height: 300 },
                    children: [
                      el({
                        tag: "img",
                        src: "https://cdn.example/p2.jpg",
                        alt: "Ghee",
                        box: { x: 240, y: 120, width: 220, height: 220 },
                      }),
                      el({ tag: "h3", text: "A2 Ghee" }),
                      el({ tag: "span", text: "Rs. 199.00" }),
                      el({ tag: "a", href: "https://shop.example/p2", text: "View" }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    };

    const theme = themeFromCapture(capture);
    expect(theme.pages[0]?.root).toBeTruthy();
    expect(theme.pages.map((p) => p.path)).toEqual([
      "/",
      "/shop",
      "/product/mp-premium-atta",
      "/product/a2-ghee",
    ]);
    const html = renderThemeHtml(theme);
    expect(html).toContain("MP Premium Atta");
    expect(html).toContain("A2 Ghee");
    expect(html).toContain("Flour");
    expect(html).toContain('href="#/shop"');
    expect(html).toContain('href="#/product/mp-premium-atta"');
    expect(html).toContain('data-route="/shop"');
    expect(html).toContain('data-route="/product/a2-ghee"');
    expect(html).toContain("https://cdn.example/p1.jpg");
    expect(html).toContain("<header");
    expect(html).toContain("max-width: none !important");
    expect(html).toContain("Add to cart");
    expect(html).toContain("Save 50%");
    expect(html).toContain("Rs. 600.00");
    expect(html).toContain("r-prices");
    expect(html).toContain("object-fit: contain");
    expect(html).not.toMatch(/class="[^"]*r-carousel/);
  });

  it("walks a page wrapper and finds a class-based header", () => {
    const capture: PageCapture = {
      schema_version: "1.0",
      url: "https://brand.example/",
      final_url: "https://brand.example/",
      captured_at: "2026-01-01T00:00:00.000Z",
      title: "Brand",
      viewport: { width: 1440, height: 900 },
      page_metrics: { scroll_width: 1440, scroll_height: 4000 },
      seo: { description: null, canonical: null, og_title: null, og_description: null, og_image: null },
      screenshots: {
        full_page: "",
        viewport_top: "screenshots/viewport-top.png",
        scroll_600: "",
        scroll_back: "",
        hovers: [],
      },
      assets: [],
      theme_hints: {
        background_color: "rgb(255,255,255)",
        text_color: "rgb(0,0,0)",
        fonts: ["Poppins"],
        color_palette: ["rgb(0,0,0)"],
        css_variables: {},
      },
      header_behavior: {
        sticky_or_fixed: true,
        lock_height_enable: true,
        always_fixed_on_scroll: true,
        reappear_on_scroll_up: false,
        document_flow: false,
        confidence: 1,
        evidence: [],
        probe: null,
      },
      hover_reveals: [],
      candidate_blocks: [],
      warnings: [],
      dom: el({
        tag: "body",
        box: { x: 0, y: 0, width: 1440, height: 3000 },
        children: [
          el({
            tag: "div",
            id: "header-container",
            className: "site-header",
            box: { x: 0, y: 0, width: 1440, height: 90 },
            children: [
              el({
                tag: "img",
                className: "logoImage",
                src: "https://cdn.example/logo.png",
                alt: "Brand",
                box: { x: 600, y: 20, width: 120, height: 50 },
              }),
              el({ tag: "span", text: "SHOP", box: { x: 40, y: 30, width: 50, height: 20 } }),
              el({ tag: "span", text: "WORLDS", box: { x: 100, y: 30, width: 70, height: 20 } }),
            ],
          }),
          el({
            tag: "div",
            id: "home-page",
            className: "page-wrapper",
            box: { x: 0, y: 90, width: 1440, height: 2400 },
            children: [
              el({
                tag: "div",
                id: "section-hero",
                box: { x: 0, y: 90, width: 1440, height: 700 },
                children: [
                  el({
                    tag: "video",
                    src: "https://cdn.example/hero.mp4",
                    box: { x: 0, y: 90, width: 1440, height: 700 },
                  }),
                ],
              }),
              el({
                tag: "div",
                id: "section-title",
                box: { x: 0, y: 800, width: 1440, height: 80 },
                children: [el({ tag: "h2", text: "SHOP BY CATEGORY" })],
              }),
              el({
                tag: "div",
                id: "section-grid",
                box: { x: 0, y: 900, width: 1440, height: 600 },
                children: [
                  el({
                    tag: "img",
                    src: "https://cdn.example/a.jpg",
                    box: { x: 0, y: 900, width: 470, height: 600 },
                  }),
                  el({
                    tag: "img",
                    src: "https://cdn.example/b.jpg",
                    box: { x: 480, y: 900, width: 470, height: 600 },
                  }),
                  el({
                    tag: "img",
                    src: "https://cdn.example/c.jpg",
                    box: { x: 960, y: 900, width: 470, height: 600 },
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    };

    const theme = themeFromCapture(capture);
    const html = renderThemeHtml(theme);
    expect(theme.pages.map((p) => p.path)).toEqual(["/", "/shop"]);
    expect(html).toContain("<header");
    expect(html).toContain("SHOP");
    expect(html).toContain("https://cdn.example/logo.png");
    expect(html).toContain("https://cdn.example/hero.mp4");
    expect(html).toContain("SHOP BY CATEGORY");
    expect(html).toContain("https://cdn.example/a.jpg");
    expect(html).toContain("https://cdn.example/c.jpg");
    expect(html).toContain('href="#/shop"');
    expect(html).toContain('data-route="/shop"');
    expect(html).not.toMatch(/<img[^>]+logo\.png[^>]*class="n-stack/);
  });

  function sample(dom: DomNode): PageCapture {
    return {
      schema_version: "1.0",
      url: "https://shop.example/",
      final_url: "https://shop.example/",
      captured_at: "2026-01-01T00:00:00.000Z",
      title: "Fixture Store",
      viewport: { width: 1440, height: 900 },
      page_metrics: { scroll_width: 1440, scroll_height: 4000 },
      seo: { description: null, canonical: null, og_title: null, og_description: null, og_image: null },
      screenshots: { full_page: "", viewport_top: "", scroll_600: "", scroll_back: "", hovers: [] },
      assets: [],
      theme_hints: {
        background_color: "rgb(255, 255, 255)",
        text_color: "rgb(63, 80, 36)",
        fonts: ["Montserrat"],
        color_palette: ["rgb(63, 80, 36)"],
        css_variables: {},
      },
      header_behavior: {
        sticky_or_fixed: false,
        lock_height_enable: false,
        always_fixed_on_scroll: false,
        reappear_on_scroll_up: false,
        document_flow: true,
        confidence: 1,
        evidence: [],
        probe: null,
      },
      hover_reveals: [],
      candidate_blocks: [],
      warnings: [],
      dom,
    };
  }

  it("turns overflowing banner sliders into a carousel", () => {
    const theme = themeFromCapture(
      sample(
        el({
          tag: "body",
          box: { x: 0, y: 0, width: 1440, height: 900 },
          children: [
            el({ tag: "header", children: [el({ tag: "span", text: "Home" })] }),
            el({
              tag: "section",
              className: "responsive-banner-slider",
              box: { x: 0, y: 80, width: 1440, height: 400 },
              children: [
                el({
                  tag: "div",
                  className: "responsive-banner-slider__slide",
                  box: { x: 0, y: 80, width: 1440, height: 400 },
                  children: [
                    el({
                      tag: "img",
                      src: "https://cdn.example/hero-1.jpg",
                      box: { x: 0, y: 80, width: 1440, height: 400 },
                    }),
                  ],
                }),
                el({
                  tag: "div",
                  className: "responsive-banner-slider__slide",
                  box: { x: 1440, y: 80, width: 1440, height: 400 },
                  children: [
                    el({
                      tag: "img",
                      src: "https://cdn.example/hero-2.jpg",
                      box: { x: 1440, y: 80, width: 1440, height: 400 },
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ),
    );
    const html = renderThemeHtml(theme);
    expect(html).toContain("r-carousel");
    expect(html).toContain("https://cdn.example/hero-1.jpg");
    expect(html).toContain("https://cdn.example/hero-2.jpg");
    expect(html).toContain("carousel-dot");
    expect(html).toContain("carousel-next");
  });

  it("rebuilds footer columns and a newsletter block", () => {
    const theme = themeFromCapture(
      sample(
        el({
          tag: "body",
          box: { x: 0, y: 0, width: 1440, height: 1600 },
          children: [
            el({ tag: "header", children: [el({ tag: "span", text: "Home" })] }),
            el({
              tag: "section",
              className: "shopify-section newsletter",
              box: { x: 0, y: 200, width: 1440, height: 300 },
              children: [
                el({ tag: "h2", text: "Catch Hold of Tasty Tips" }),
                el({ tag: "p", text: "Subscribe to our mailing list and stay updated." }),
                el({
                  tag: "input",
                  type: "email",
                  placeholder: "Email",
                  box: { x: 540, y: 400, width: 320, height: 44 },
                }),
              ],
            }),
            el({
              tag: "footer",
              box: { x: 0, y: 520, width: 1440, height: 500 },
              style: {
                display: "block",
                position: "static",
                top: "auto",
                left: "auto",
                right: "auto",
                bottom: "auto",
                zIndex: "auto",
                overflow: "visible",
                opacity: "1",
                visibility: "visible",
                transform: "none",
                backgroundColor: "rgb(60, 79, 25)",
                backgroundImage: "none",
                color: "rgb(255, 255, 255)",
                fontFamily: "Montserrat",
                fontSize: "16px",
                fontWeight: "400",
                lineHeight: "1.4",
                textAlign: "left",
                padding: "0",
                margin: "0",
                borderRadius: "0",
                boxShadow: "none",
                flexDirection: "row",
                justifyContent: "flex-start",
                alignItems: "stretch",
                gap: "0",
                gridTemplateColumns: "none",
              },
              children: [
                el({
                  tag: "div",
                  className: "footer-block grid__item",
                  box: { x: 170, y: 540, width: 356, height: 280 },
                  children: [
                    el({
                      tag: "img",
                      src: "https://cdn.example/sun.png",
                      box: { x: 170, y: 540, width: 100, height: 100 },
                    }),
                    el({
                      tag: "p",
                      text: "Join us on a journey that promises not just sustenance but soulful nourishment.",
                    }),
                    el({ tag: "a", href: "https://www.facebook.com/shop", text: "Facebook" }),
                    el({ tag: "a", href: "https://www.instagram.com/shop", text: "Instagram" }),
                  ],
                }),
                el({
                  tag: "div",
                  className: "footer-block grid__item",
                  box: { x: 542, y: 540, width: 356, height: 280 },
                  children: [
                    el({
                      tag: "img",
                      src: "https://cdn.example/LOGO_WHITE.png",
                      box: { x: 605, y: 540, width: 230, height: 60 },
                    }),
                  ],
                }),
                el({
                  tag: "div",
                  className: "footer-block grid__item footer-block--menu",
                  box: { x: 914, y: 540, width: 356, height: 280 },
                  children: [
                    el({ tag: "h2", text: "Quick Links" }),
                    el({ tag: "a", href: "https://shop.example/pages/terms", text: "T&C" }),
                    el({ tag: "a", href: "https://shop.example/pages/contact", text: "Contact Us" }),
                    el({ tag: "a", href: "https://shop.example/pages/about-us", text: "About Us" }),
                  ],
                }),
                el({
                  tag: "div",
                  className: "footer__content-bottom",
                  box: { x: 0, y: 900, width: 1440, height: 40 },
                  children: [
                    el({ tag: "small", text: "© 2026," }),
                    el({ tag: "a", href: "https://shop.example/", text: "Anmasa-store" }),
                    el({ tag: "a", href: "https://shop.example/policies/privacy-policy", text: "Privacy policy" }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ),
    );
    const html = renderThemeHtml(theme);
    expect(html).toContain("Catch Hold of Tasty Tips");
    expect(html).toContain("r-newsletter");
    expect(html).toContain("Quick Links");
    expect(html).toContain("T&amp;C");
    expect(html).toContain("Contact Us");
    expect(html).toContain("https://cdn.example/LOGO_WHITE.png");
    expect(html).toContain("https://www.facebook.com/shop");
    expect(html).toContain("#3c4f19");
    expect(html).toContain("<footer");
    expect(html).toContain("Privacy policy");
    expect(html).toContain('type="email"');
  });

  function productSlide(x: number, src: string, title: string): DomNode {
    return el({
      tag: "li",
      className: "grid__item slider__slide",
      box: { x, y: 80, width: 224, height: 400 },
      children: [
        el({ tag: "img", src, box: { x, y: 80, width: 220, height: 220 } }),
        el({ tag: "h3", text: title }),
        el({ tag: "span", text: "Rs. 600.00" }),
        el({ tag: "span", text: "Rs. 299.00" }),
      ],
    });
  }

  it("slides product collections one card at a time with a counter", () => {
    const theme = themeFromCapture(
      sample(
        el({
          tag: "body",
          box: { x: 0, y: 0, width: 1440, height: 900 },
          children: [
            el({ tag: "header", children: [el({ tag: "span", text: "Home" })] }),
            el({
              tag: "section",
              className: "collection",
              box: { x: 0, y: 80, width: 1440, height: 500 },
              children: [
                el({ tag: "h2", text: "~ Best sellers ~" }),
                el({
                  tag: "ul",
                  className: "grid product-grid grid--5-col-desktop slider",
                  box: { x: 0, y: 120, width: 1440, height: 400 },
                  children: [
                    productSlide(162, "https://cdn.example/c1.jpg", "Atta One"),
                    productSlide(402, "https://cdn.example/c2.jpg", "Atta Two"),
                    productSlide(641, "https://cdn.example/c3.jpg", "Atta Three"),
                    productSlide(881, "https://cdn.example/c4.jpg", "Atta Four"),
                    productSlide(1120, "https://cdn.example/c5.jpg", "Atta Five"),
                    productSlide(1600, "https://cdn.example/c6.jpg", "Atta Six"),
                  ],
                }),
              ],
            }),
          ],
        }),
      ),
    );
    const html = renderThemeHtml(theme);
    expect(html).toContain('data-mode="strip"');
    expect(html).toContain("carousel-counter");
    expect(html).toContain("Atta One");
    expect(html).toContain("Atta Six");
    expect(html).toContain("~ Best sellers ~");
  });

  it("renders collection lists as tiles instead of product cards", () => {
    const theme = themeFromCapture(
      sample(
        el({
          tag: "body",
          box: { x: 0, y: 0, width: 1440, height: 1200 },
          children: [
            el({ tag: "header", children: [el({ tag: "span", text: "Home" })] }),
            el({
              tag: "section",
              className: "shopify-section section-collection-list",
              box: { x: 0, y: 80, width: 1440, height: 900 },
              children: [
                el({ tag: "h2", text: "~ Our Range of Goodness ~" }),
                el({
                  tag: "ul",
                  className: "collection-list contains-card--collection grid--3-col-desktop",
                  box: { x: 170, y: 140, width: 1100, height: 800 },
                  children: [
                    el({
                      tag: "li",
                      className: "collection-list__item grid__item slider__slide",
                      box: { x: 170, y: 140, width: 356, height: 433 },
                      children: [
                        el({
                          tag: "img",
                          src: "https://cdn.example/flour.jpg",
                          box: { x: 170, y: 140, width: 354, height: 354 },
                        }),
                        el({ tag: "h3", text: "Flour" }),
                        el({ tag: "a", href: "https://shop.example/collections/flour", text: "Flour" }),
                      ],
                    }),
                    el({
                      tag: "li",
                      className: "collection-list__item grid__item slider__slide",
                      box: { x: 542, y: 140, width: 356, height: 433 },
                      children: [
                        el({
                          tag: "img",
                          src: "https://cdn.example/oil.jpg",
                          box: { x: 542, y: 140, width: 354, height: 354 },
                        }),
                        el({ tag: "h3", text: "Oil & Ghee" }),
                        el({ tag: "a", href: "https://shop.example/collections/oil", text: "Oil & Ghee" }),
                      ],
                    }),
                    el({
                      tag: "li",
                      className: "collection-list__item grid__item slider__slide",
                      box: { x: 914, y: 140, width: 356, height: 433 },
                      children: [
                        el({
                          tag: "img",
                          src: "https://cdn.example/spices.jpg",
                          box: { x: 914, y: 140, width: 354, height: 354 },
                        }),
                        el({ tag: "h3", text: "Spices" }),
                        el({ tag: "a", href: "https://shop.example/collections/spices", text: "Spices" }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ),
    );
    const html = renderThemeHtml(theme);
    expect(html).toContain("Our Range of Goodness");
    expect(html).toContain("r-collections");
    expect(html).toContain("r-tile");
    expect(html).toContain("https://cdn.example/flour.jpg");
    expect(html).toContain("Oil &amp; Ghee");
    expect(html).not.toMatch(/r-tile[\s\S]{0,400}Add to cart/);
  });

  it("rebuilds a footer from geometry without theme class names", () => {
    const theme = themeFromCapture(
      sample(
        el({
          tag: "body",
          box: { x: 0, y: 0, width: 1440, height: 900 },
          children: [
            el({ tag: "header", children: [el({ tag: "span", text: "Home" })] }),
            el({
              tag: "footer",
              box: { x: 0, y: 600, width: 1440, height: 280 },
              style: {
                display: "block",
                position: "static",
                top: "auto",
                left: "auto",
                right: "auto",
                bottom: "auto",
                zIndex: "auto",
                overflow: "visible",
                opacity: "1",
                visibility: "visible",
                transform: "none",
                backgroundColor: "rgb(20, 20, 20)",
                backgroundImage: "none",
                color: "rgb(255, 255, 255)",
                fontFamily: "Inter",
                fontSize: "16px",
                fontWeight: "400",
                lineHeight: "1.4",
                textAlign: "left",
                padding: "0",
                margin: "0",
                borderRadius: "0",
                boxShadow: "none",
                flexDirection: "row",
                justifyContent: "flex-start",
                alignItems: "stretch",
                gap: "0",
                gridTemplateColumns: "none",
              },
              children: [
                el({
                  tag: "div",
                  box: { x: 80, y: 620, width: 280, height: 180 },
                  children: [
                    el({ tag: "h3", text: "Company" }),
                    el({ tag: "a", href: "https://brand.example/about", text: "About" }),
                    el({ tag: "a", href: "https://brand.example/careers", text: "Careers" }),
                  ],
                }),
                el({
                  tag: "div",
                  box: { x: 420, y: 620, width: 280, height: 180 },
                  children: [
                    el({ tag: "h3", text: "Help" }),
                    el({ tag: "a", href: "https://brand.example/faq", text: "FAQ" }),
                    el({ tag: "a", href: "https://brand.example/returns", text: "Returns" }),
                  ],
                }),
                el({
                  tag: "div",
                  box: { x: 0, y: 830, width: 1440, height: 40 },
                  children: [el({ tag: "small", text: "© 2026 Brand Inc. All rights reserved." })],
                }),
              ],
            }),
          ],
        }),
      ),
    );
    const html = renderThemeHtml(theme);
    expect(html).toContain("<footer");
    expect(html).toContain("Company");
    expect(html).toContain("Careers");
    expect(html).toContain("Help");
    expect(html).toContain("FAQ");
    expect(html).toContain("All rights reserved");
  });

  it("detects priced cards from similar boxes without product-card classes", () => {
    const theme = themeFromCapture(
      sample(
        el({
          tag: "body",
          box: { x: 0, y: 0, width: 1440, height: 800 },
          children: [
            el({ tag: "header", children: [el({ tag: "span", text: "Home" })] }),
            el({
              tag: "section",
              box: { x: 0, y: 80, width: 1440, height: 420 },
              children: [
                el({ tag: "h2", text: "New arrivals" }),
                el({
                  tag: "div",
                  box: { x: 40, y: 140, width: 260, height: 320 },
                  children: [
                    el({
                      tag: "img",
                      src: "https://cdn.example/tee.jpg",
                      box: { x: 40, y: 140, width: 240, height: 240 },
                    }),
                    el({ tag: "h3", text: "Cotton Tee" }),
                    el({ tag: "span", text: "$24.00" }),
                  ],
                }),
                el({
                  tag: "div",
                  box: { x: 320, y: 140, width: 260, height: 320 },
                  children: [
                    el({
                      tag: "img",
                      src: "https://cdn.example/hoodie.jpg",
                      box: { x: 320, y: 140, width: 240, height: 240 },
                    }),
                    el({ tag: "h3", text: "Hoodie" }),
                    el({ tag: "span", text: "$48.00" }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ),
    );
    const html = renderThemeHtml(theme);
    expect(html).toContain("Cotton Tee");
    expect(html).toContain("Hoodie");
    expect(html).toContain("$24.00");
    expect(html).toContain("r-card");
    expect(html).not.toContain("Add to cart");
  });
});

describe("connected page helpers", () => {
  it("slugifies unique product paths", () => {
    const used = new Set<string>();
    expect(slugify("MP Premium Atta", used)).toBe("mp-premium-atta");
    expect(slugify("MP Premium Atta", used)).toBe("mp-premium-atta-2");
  });

  it("routes collection-like nav to the shop list", () => {
    expect(internalNavHref("/collections/all", "Shop")).toBe("#/shop");
    expect(internalNavHref("/about", "About")).toBe("/about");
    expect(internalNavHref("/collections/atta", "Flour")).toBe("#/shop");
    expect(internalNavHref("/flour", "Flour")).toBe("/flour");
  });
});
