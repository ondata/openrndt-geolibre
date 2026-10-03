import { afterEach, describe, expect, it, vi } from "vitest";
import { linkSearchFrom } from "../src/rndt/url-params";

const read = (query: string) => linkSearchFrom(new URLSearchParams(query));

describe("linkSearchFrom", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads the text", () => {
    expect(read("rndt=idrografia")).toEqual({ text: "idrografia", bbox: null });
    expect(read("rndt=uso+del+suolo")).toEqual({ text: "uso del suolo", bbox: null });
  });

  it("reads the box, alone or with the text", () => {
    expect(read("rndtBbox=12.3,37.5,13.9,38.3")).toEqual({ text: "", bbox: [12.3, 37.5, 13.9, 38.3] });
    expect(read("rndt=catastale&rndtBbox=12.3, 37.5, 13.9, 38.3")).toEqual({
      text: "catastale",
      bbox: [12.3, 37.5, 13.9, 38.3],
    });
  });

  it("asks for no search without a value", () => {
    expect(read("rndt")).toBeNull();
    expect(read("rndt=%20&rndtBbox=")).toBeNull();
    expect(read("url=https://example.com/p.json")).toBeNull();
  });

  it("is case-sensitive on the names, as GeoLibre is", () => {
    expect(read("Rndt=idrografia&rndtbbox=12,37,13,38")).toBeNull();
  });

  it("takes the first value of a repeated parameter", () => {
    expect(read("rndt=uno&rndt=due")?.text).toBe("uno");
  });

  it("leaves out a box that is not valid, with a warning, and keeps the text", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(read("rndt=ortofoto&rndtBbox=12,37,13")).toEqual({ text: "ortofoto", bbox: null });
    expect(read("rndt=ortofoto&rndtBbox=12,37,13,abc")).toEqual({ text: "ortofoto", bbox: null });
    expect(read("rndt=ortofoto&rndtBbox=12,37,200,38")).toEqual({ text: "ortofoto", bbox: null });
    expect(read("rndt=ortofoto&rndtBbox=13,37,12,38")).toEqual({ text: "ortofoto", bbox: null });
    expect(read("rndtBbox=nope")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(5);
  });
});
