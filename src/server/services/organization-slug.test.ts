import { describe, expect, it } from "vitest";
import { slugify } from "./organization-slug";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Clinic Example")).toBe("clinic-example");
  });

  it("strips diacritics", () => {
    expect(slugify("Clínica Nutrición")).toBe("clinica-nutricion");
  });

  it("collapses non-alphanumeric runs into a single hyphen", () => {
    expect(slugify("Clinic & Co.  Example!!")).toBe("clinic-co-example");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  --Clinic--  ")).toBe("clinic");
  });

  it("falls back to a default slug when nothing alphanumeric remains", () => {
    expect(slugify("!!!")).toBe("org");
  });
});
