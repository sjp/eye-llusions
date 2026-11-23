import { describe, expect, test } from "vitest";
import { readChunks, writeChunks } from "../core/png/chunks.ts";
import { decodeITxt } from "../core/png/itxt.ts";
import type { Recipe } from "../core/recipe.ts";
import { decompress, fromBase64Url } from "./bytes.ts";
import projectV1Png from "./fixtures/project-v1.png?inline";
import projectV2Png from "./fixtures/project-v2.png?inline";
import { embedProject, readProject } from "./projectFile.ts";
import { decodeRecipe, encodeRecipe } from "./share.ts";

// Links and project files saved by earlier releases. They are frozen: they must keep
// opening, so a format change adds a migration rather than editing them. A deliberate
// change to what the encoders write moves the "still how the scene is written" tests to
// new fixtures in the new format; the old ones keep their opening tests.

const LAYERED_LINK =
  "1.nZbNbtswDMdfZeBZDWwnTlqfu6GHAh3aAT10PSg2EwtVJEOS02ZFXmOnPcDeY2-yJxkofylNXbS72KYdkT-Sf1F5hi0aK7SCLGbAbYW5gyyepAwsYgHZNJ7F6VkyT6cMJN-hsZDdPcODUAVkYPmmkggMhLeqEg1Zim8QMrjp7K2wYikRMmdqZLCU6Fdv-BMwKLBypQ9vS14hZM_gdnTv_O0Z5KgcGvr0BFk0SRjs_D3dM7DiB5Ix3bMRLiOqSqIdwK77FyNkvCgGsshX4wXb4NMItbaQzY8x09cwZ6OY1c7wjSgGzK_9ixFMWy-d4bl7s4qDWysKtJClx6SnHyuo06YOyvmtNXvKFZc2wDRYSZ7jm5SdS1eK_EGhtS3BWOsXB6TpKKp1XJiA9aaz_1uTwnDZe7EOKwtZPGfgaqMsZMm4Dhbv00GJ3LiB-KI13wNMMY6ZV2Jd-33YPnQhxnWwGNOBwyfXq6B5bjFvtSk-UFe_OIOLz5eXV9_V7Z-f15fnn_7--k2UWtEnbvJSbPXJUvL8AQacZLS-BI3FmmiWuEUJjXkriqY2URJkUhj-KNS6S2Yw23zOtS7kG8PrxYiYkxaMfsBmPi5NbUsC7Kgj6oteuU7aKYONLryi0HeXy9r_8HTfq-oujpIZS6LZKfNPJ_7aX-4pm6NAcRgn7qMYLiyGcaZBnDRO2DQ9HfEYJQfovUupH9GELkn6lRbKkU8ioWZFkymLJiOuDz1PkqAqG61dGXpPA-CmEmmcRGwaLRJ2Qtf7_X3QX7Hh635LdUY3WEvt9Lu31BkdjNSlDKp24UqQlWvluFAURG3RuM6PJPFZyrPRbtOVx1I4n8jZnkLVxtc2ppJZh8ZXZEYD0KAttSwgU7WUYxlZIUtdo3PheRu-e-c-fD0z6wy6vAwya0f6cWp9YvGQ1kFOlMVBWtTK-2YC-Gn0DGtUaLjTJjxguSr05lw763mVFW7Xzk2ouPRZBoecwWYf-eLoHLmi8WZzTiUI_s_MSKRbgY-02GCFnNR61pbkavVFYMM466WYG20t7Pf_AA";

/** Every layer kind and sample shape, the four blend modes and both kinds of stroke. */
const LAYERED: Recipe = {
  version: 1,
  aspect: 1.5,
  seed: 3_141_592_653,
  layers: [
    {
      kind: "sample",
      id: "sphere",
      name: "Sphere",
      visible: true,
      blend: "max",
      depth: 1,
      shape: { type: "sphere" },
      center: { x: 0.2, y: 0.25 },
      size: 0.3,
    },
    {
      kind: "sample",
      id: "ripples",
      name: "Ripples",
      visible: true,
      blend: "add",
      depth: 0.5,
      shape: { type: "ripples", rings: 6 },
      center: { x: 0.5, y: 0.25 },
      size: 0.4,
    },
    {
      kind: "sample",
      id: "pyramid",
      name: "Pyramid",
      visible: true,
      blend: "subtract",
      depth: 1,
      shape: { type: "pyramid", sides: 5 },
      center: { x: 0.8, y: 0.25 },
      size: 0.3,
    },
    {
      kind: "sample",
      id: "torus",
      name: "Torus",
      visible: false,
      blend: "replace",
      depth: 1,
      shape: { type: "torus", thickness: 0.3 },
      center: { x: 0.2, y: 0.75 },
      size: 0.35,
    },
    {
      kind: "sample",
      id: "stairs",
      name: "Stairs",
      visible: true,
      blend: "max",
      depth: 1,
      shape: { type: "spiralStairs", steps: 16, turns: 2 },
      center: { x: 0.5, y: 0.75 },
      size: 0.4,
    },
    {
      kind: "sample",
      id: "heart",
      name: "Heart",
      visible: true,
      blend: "max",
      depth: 0.75,
      shape: { type: "figure", figure: "heart" },
      center: { x: 0.8, y: 0.75 },
      size: 0.3,
    },
    {
      kind: "text",
      id: "text",
      name: "Words",
      visible: true,
      blend: "max",
      depth: 1,
      text: "HELLO\nWÖRLD ✨",
      font: "archivo-black",
      size: 0.2,
      center: { x: 0.5, y: 0.5 },
      edge: "bevel",
      edgeWidth: 0.02,
    },
    {
      kind: "drawing",
      id: "drawing",
      name: "Doodle",
      visible: true,
      blend: "add",
      depth: 0.6,
      strokes: [
        {
          brush: { size: 0.05, softness: 0.5, mode: "set", value: 0.8 },
          points: [0.25, 0.5, 0.5, 0.25, 0.75, 0.5],
        },
        { brush: { size: 0.1, softness: 1, mode: "raise", value: 0.3 }, points: [0.125, 0.875] },
        // Off the drawing grid, so it travels unpacked.
        {
          brush: { size: 0.02, softness: 0, mode: "lower", value: 0.2 },
          points: [0.1, 0.2, 0.3, 0.4],
        },
        {
          brush: { size: 0.2, softness: 0.25, mode: "smooth", value: 0.5 },
          points: [-0.25, 1.25, 0.5, 0.5],
        },
      ],
    },
    {
      kind: "image",
      id: "image",
      name: "Photo",
      visible: true,
      blend: "max",
      depth: 0.9,
      asset: "photo",
      fit: "contain",
      invert: true,
      levels: { black: 0.1, white: 0.9 },
      blur: 0.01,
      posterize: 4,
      threshold: null,
    },
    {
      kind: "image",
      id: "silhouette",
      name: "Silhouette",
      visible: true,
      blend: "max",
      depth: 1,
      asset: "photo",
      fit: "stretch",
      invert: false,
      levels: { black: 0, white: 1 },
      blur: 0,
      posterize: null,
      threshold: 0.5,
    },
  ],
  texture: {
    generator: { type: "randomDots", density: 0.4 },
    palette: { type: "preset", id: "ocean" },
    scale: 1.5,
    seed: 42,
  },
  view: { repeats: 9, depthOfField: 0.4, mode: "cross" },
  assets: {},
};

const SCENE = {
  version: 1,
  aspect: 1,
  seed: 7,
  layers: [
    {
      kind: "sample",
      id: "sphere",
      name: "Sphere",
      visible: true,
      blend: "max",
      depth: 1,
      shape: { type: "sphere" },
      center: { x: 0.5, y: 0.5 },
      size: 0.6,
    },
  ],
  view: { repeats: 8, depthOfField: 0.3, mode: "wall" },
  assets: {},
} as const satisfies Omit<Recipe, "texture">;

/** The other texture generators, with both kinds of palette. */
const TEXTURE_LINKS: [string, Recipe][] = [
  [
    "1.TZDNTsMwEITfZXq1UErFj_wAHOHAEfWwcabUwokte9Mfqrw7sqGop52Rtd949oIDc_Fxgl0bSEl02mQhB9gngyBn5gL7ccGXnwZYFBlTIAx8c2nPXN0kI2HxfvUHX3wfCKt5pkEf2LZHOcFgYNL9b9BeEmEv0HOdV95i4Dgpc306wXZ3DwbnNheD4r9Z9eOyNVCedM6N8cmJWTTmG6CLIc75NfrSqEkCVW8T3Vw0jjAoGlNtitW6u-82HQxW0vWda2rHwfWCbY13Uov9n2m91Lo8VmhmomiBff5r-bZ78QxD_e7GYIxDzTxKCFiWHw",
    {
      ...SCENE,
      texture: {
        generator: { type: "colourNoise" },
        palette: { type: "custom", stops: ["#102030", "#a0b0c0", "#fedcba"] },
        scale: 1,
        seed: 1,
      },
    },
  ],
  [
    "1.TVDLTsMwEPyXOVuI8pY_gCMcOCIO22RKLBzbsrdpQuR_R06p1NPuaDWvXTExFxcD7M5ASmKn21rIHvbZwMvCXGA_V_y40MOiyJg8YeA2lAbmhoKMhMXHBU-uuL0nrOYjDfaeG3uUGQY9kw5no0ESYVfo0uZFrxp0DMrcTjPs7c2jwbLNalDcL9v-VL8MlLMe86bxzcAsGvOV4CFLp-LfoistVuxUJhbYh2qQxFP12j5lFuqlXGAMLUrppDXZtRDnz9zV1pCnRs1MFC2wL__F3g-vjr5vCe8Nxtg35ZN4j1r_AA",
    {
      ...SCENE,
      texture: {
        generator: { type: "fractalNoise", octaves: 4 },
        palette: { type: "preset", id: "neon" },
        scale: 1.5,
        seed: 2,
      },
    },
  ],
  [
    "1.TZDBbsMgEET_ZXJFVaooTcUH9NpDj1UOxEwSVIwRrBO7Fv9eQWope9kdwc7T7IIbU3ZDgH5VMDmykzZm0kIfFLyZmTL094IfFyw0sumjJxRcU_HKVFUwPaHxteqby-7kCS1ppMLJs233ZoKCZZTrA3Q1kdALZK599SsKHYMw1acJevuyV5hbLwrZ_bLOb-WoIJxkTM3jwsBkZEhPhh29z2gg68LlsaYQjafIM7kbswx9_SlDrImx2baCwubcCscK74xv9MN-vdOu1Ly8V7fESCMZ-v0_5uf5w9HburFT6AdbYXfjPUr5Aw",
    {
      ...SCENE,
      texture: {
        generator: { type: "cells", shading: 0.6 },
        palette: { type: "custom", stops: ["#000000", "#ffffff"] },
        scale: 0.75,
        seed: 3,
      },
    },
  ],
  [
    "1.TZDNTsQwDITfZc4RAvGrPABXDntccfC2A41I0yhxd1uqvDtKoGhP9sjyNx5vODNlNwXYOwPJkZ22NpM97LOBl5Upwx43fLnQwyLLGD1h4JqKA1NVQUbC4rDrs8vu5AmraabBybNtj7LAoGfU4ddokEjYDbrWuvOKQcegTHW0wN7ePBqsrRaD7L5Z-6fybqBcdE6N8cnAJDqla2AnqkzsD9UpN_OQnTbYfTGI4ql6fUNMzNQ9ocw6j6FelDupgf7f81BqTF7qamKkaIZ9-Uv39vHq6PvmYjBOfSVfxHuU8gM",
    {
      ...SCENE,
      texture: {
        generator: { type: "scatteredShapes", density: 0.3 },
        palette: { type: "preset", id: "autumn" },
        scale: 1,
        seed: 4,
      },
    },
  ],
  [
    "1.TVDLTsMwEPyXOVsIVPGQP4ArB46IwzYeiMFxLHubJkT5d2S3hZ52R6t57YqJufgxwt4ZSEnstK2FdLCPBkEW5gL7tuLbRweLIkMKhIFvKPXMFUUZCIvXC5588ftAWM0HGuwDG3uQGQaOSfuTUS-JsCt0qfOitxl0jMpcTzPs7c29wdLmZlD8D-v-sL0bKGc95KbxycgsOuYrQfUtrJRC_YfO13xjLLA7gy-vzeqkniRQ9TpUyqzsc-VhjGMNWDqp_f6-VbmT57ESMxNFC-zTuezLx7NncNVjZzCMruoeJQRs2y8",
    {
      ...SCENE,
      texture: {
        generator: { type: "tile", asset: "tile", divisions: 3, jitter: 0.5 },
        palette: { type: "preset", id: "mono" },
        scale: 1,
        seed: 5,
      },
    },
  ],
];

/** Each link, named by its texture generator. */
const LINKS = [[LAYERED_LINK, LAYERED] as const, ...TEXTURE_LINKS].map(
  ([payload, recipe]) => [recipe.texture.generator.type, payload, recipe] as const,
);

/** The JSON inside a link payload. */
async function linkJson(payload: string): Promise<unknown> {
  const bytes = fromBase64Url(payload.slice(payload.indexOf(".") + 1));
  const json = await decompress(bytes, "deflate-raw", 1024 * 1024);
  return JSON.parse(new TextDecoder().decode(json));
}

/** An image layer and a tiled texture, with a grey and a colour asset. */
const PROJECT: Recipe = {
  version: 1,
  aspect: 1.25,
  seed: 123_456_789,
  layers: [
    {
      kind: "sample",
      id: "sphere",
      name: "Sphere",
      visible: true,
      blend: "max",
      depth: 1,
      shape: { type: "sphere" },
      center: { x: 0.5, y: 0.5 },
      size: 0.6,
    },
    {
      kind: "image",
      id: "image",
      name: "Photo ✨",
      visible: true,
      blend: "add",
      depth: 0.7,
      asset: "photo",
      fit: "cover",
      invert: false,
      levels: { black: 0.2, white: 0.8 },
      blur: 0.02,
      posterize: null,
      threshold: null,
    },
    {
      kind: "drawing",
      id: "drawing",
      name: "Doodle",
      visible: true,
      blend: "max",
      depth: 1,
      strokes: [
        {
          brush: { size: 0.05, softness: 0.5, mode: "raise", value: 0.4 },
          points: [0.25, 0.5, 0.5, 0.25],
        },
        {
          brush: { size: 0.05, softness: 0.5, mode: "raise", value: 0.4 },
          points: [0.1, 0.2, 0.3, 0.4],
        },
      ],
    },
  ],
  texture: {
    generator: { type: "tile", asset: "tile", divisions: 2, jitter: 0.25 },
    palette: { type: "custom", stops: ["#112233", "#ddeeff"] },
    scale: 1,
    seed: 9,
  },
  view: { repeats: 6, depthOfField: 0.35, mode: "wall" },
  assets: {
    photo: { format: "gray", width: 3, height: 2, data: Uint8Array.of(0, 64, 128, 255, 192, 32) },
    tile: {
      format: "rgba",
      width: 2,
      height: 2,
      data: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128),
    },
  },
};

function projectBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Uint8Array.from(atob(base64), (char) => char.codePointAt(0) ?? 0);
}

/**
 * The project embedded in a PNG, with each asset's pixels inflated but not unfiltered,
 * since deflate's output may differ between platforms while its input can't.
 */
async function projectContents(png: Uint8Array): Promise<unknown> {
  const chunks = readChunks(png);
  const text = chunks.find((each) => each.type === "iTXt");
  if (text === undefined) {
    throw new Error("no iTXt chunk");
  }
  const json = await decompress(new Uint8Array(decodeITxt(text).text), "deflate", 1024 * 1024);
  const assets: Record<string, number[]> = {};
  for (const chunk of chunks.filter((each) => each.type === "eyAs")) {
    const end = chunk.data.indexOf(0);
    const id = new TextDecoder().decode(chunk.data.subarray(0, end));
    const pixels = await decompress(new Uint8Array(chunk.data.subarray(end + 1)), "deflate-raw");
    assets[id] = [...pixels];
  }
  const project: unknown = JSON.parse(new TextDecoder().decode(json));
  return { project, assets };
}

describe("share links from earlier releases", () => {
  test.each(LINKS)(
    "the %s link opens as the scene it was made from",
    async (_, payload, recipe) => {
      expect(await decodeRecipe(payload)).toEqual(recipe);
    },
  );

  test.each(LINKS)("the %s link is still how the scene is written", async (_, payload, recipe) => {
    expect(await linkJson(await encodeRecipe(recipe))).toEqual(await linkJson(payload));
  });
});

describe("project files from earlier releases", () => {
  test.each([
    ["1", projectV1Png],
    ["2", projectV2Png],
  ])("format %s opens as the scene it was saved from", async (_, png) => {
    expect(await readProject(projectBytes(png))).toEqual(PROJECT);
  });

  test("format 2 is still how the scene is written", async () => {
    const original = projectBytes(projectV2Png);
    const image = readChunks(original).filter(
      (chunk) => chunk.type !== "iTXt" && chunk.type !== "eyAs",
    );
    const fresh = await embedProject(writeChunks(image), PROJECT);
    expect(await projectContents(fresh)).toEqual(await projectContents(original));
  });
});
