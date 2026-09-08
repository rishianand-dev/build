import { internStyle } from "../schema/compact.js";
import type { BindMap, Node, ThemeDoc } from "../schema/theme.js";

export function slugify(title: string, used: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "item";
  let slug = base;
  let n = 2;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

export function internalNavHref(href: string, label: string): string {
  const path = href.toLowerCase();
  const lab = label.toLowerCase().trim();
  if (/about|contact|blog|story/.test(lab) && !/\/(shop|collections?|catalog)\b/.test(path)) return href || "#/";
  if (
    /\/(collections?|catalog|shop|categor(?:y|ies)|products?)(\/|$)/i.test(href) ||
    /^(shop|store|catalog|all products)$/i.test(lab)
  ) {
    return "#/shop";
  }
  return href;
}

export function attachConnectedPages(
  theme: ThemeDoc,
  input: {
    header: Node[];
    footer: Node | null;
    catalog: BindMap[];
    pageStyle: string;
    sectionStyle: string;
    h2Style: string;
    gridStyle: string;
    priceStyle: string;
    wasStyle: string;
  },
): void {
  const detailRow = internStyle(theme.styles, { gap: "$space.6", align: "start", pad: ["$space.6", "$space.4"] });
  const detailCopy = internStyle(theme.styles, { gap: "$space.3" });
  const buyStyle = internStyle(theme.styles, {
    bg: "$color.fg",
    color: "$color.card",
    pad: ["$space.3", "$space.4"],
    align: "center",
    justify: "center",
  });
  const backStyle = internStyle(theme.styles, { size: "$size.sm", color: "$color.muted" });

  const shopItems: BindMap[] = input.catalog.map((item) => ({
    ...item,
    href: `#/product/${String(item.slug ?? "item")}`,
  }));

  const shopBody: Node[] = [
    { type: "text", text: "Shop", tag: "h1", style: input.h2Style },
    {
      type: "text",
      text:
        shopItems.length > 0
          ? "A list page built from products found on the captured homepage."
          : "No product cards were detected on the homepage yet.",
      tag: "p",
    },
  ];
  if (shopItems.length) {
    shopBody.push({ type: "list", of: "card", items: shopItems, style: input.gridStyle, role: "list" });
  }

  theme.pages.push({
    id: "list",
    path: "/shop",
    name: "Shop",
    title: `Shop · ${theme.site.name || "Store"}`,
    root: {
      type: "stack",
      style: input.pageStyle,
      children: [
        ...input.header,
        { type: "stack", style: input.sectionStyle, children: shopBody },
        ...(input.footer ? [input.footer] : []),
      ],
    },
  });

  for (const item of shopItems) {
    const slug = String(item.slug ?? "item");
    const title = String(item.title ?? "Product");
    const price = String(item.price ?? "");
    const was = String(item.was ?? "");
    const img = String(item.img ?? "");
    theme.pages.push({
      id: `product-${slug}`,
      path: `/product/${slug}`,
      name: title,
      title,
      root: {
        type: "stack",
        style: input.pageStyle,
        children: [
          ...input.header,
          {
            type: "stack",
            style: detailRow,
            role: "main",
            children: [
              {
                type: "link",
                href: "#/shop",
                style: backStyle,
                children: [{ type: "text", text: "← Shop", tag: "span" }],
              },
              {
                type: "row",
                children: [
                  { type: "image", asset: img, alt: title },
                  {
                    type: "stack",
                    style: detailCopy,
                    children: [
                      { type: "text", text: title, tag: "h1", style: input.h2Style },
                      ...(price ? [{ type: "text" as const, text: price, style: input.priceStyle }] : []),
                      ...(was ? [{ type: "text" as const, text: was, style: input.wasStyle }] : []),
                      {
                        type: "text",
                        text: `A closer look at ${title}. This details page is generated from the captured card so the list and the product stay connected.`,
                        tag: "p",
                      },
                      ...(item.cta
                        ? [{ type: "button" as const, text: String(item.cta), href: "#/shop", style: buyStyle }]
                        : []),
                    ],
                  },
                ],
              },
            ],
          },
          ...(input.footer ? [input.footer] : []),
        ],
      },
    });
  }
}
