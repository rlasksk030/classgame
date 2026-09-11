/**
 * 게임 보상 규칙의 단일 출처.
 * XP/별은 학업 점수와 분리되며, 외형은 좌표 채점에 절대 영향을 주지 않는다.
 */
export type RewardMaterial = "wood" | "pastel" | "brick" | "tile";
export type RewardTheme = "blueprint" | "museum" | "sky";

export interface RewardDefinition {
  id: string;
  kind: "material" | "theme";
  label: string;
  description: string;
  unlockXp: number;
  useIn: string;
  material?: RewardMaterial;
  theme?: RewardTheme;
}

export const REWARD_RULE_VERSION = 1;
export const REWARD_CATALOG: readonly RewardDefinition[] = [
  { id: "material:wood", kind: "material", material: "wood", label: "원목", description: "따뜻한 원목 블록", unlockXp: 0, useIn: "10·11차시 건축물" },
  { id: "material:pastel", kind: "material", material: "pastel", label: "파스텔", description: "밝고 산뜻한 파스텔 블록", unlockXp: 50, useIn: "10·11차시 건축물" },
  { id: "material:brick", kind: "material", material: "brick", label: "벽돌", description: "단단한 벽돌 블록", unlockXp: 150, useIn: "10·11차시 건축물" },
  { id: "material:tile", kind: "material", material: "tile", label: "타일", description: "깔끔한 타일 블록", unlockXp: 300, useIn: "10·11차시 건축물" },
  { id: "theme:blueprint", kind: "theme", theme: "blueprint", label: "설계 도면", description: "차분한 설계 도면 테마", unlockXp: 0, useIn: "11차시 소개서" },
  { id: "theme:museum", kind: "theme", theme: "museum", label: "전시관", description: "작품을 돋보이게 하는 전시관 테마", unlockXp: 250, useIn: "11차시 소개서" },
  { id: "theme:sky", kind: "theme", theme: "sky", label: "하늘 정원", description: "밝은 하늘색 전시 테마", unlockXp: 450, useIn: "11차시 소개서" },
];

export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(Math.max(0, xp) / 100) + 1);
}

export function unlockedRewards(xp: number): RewardDefinition[] {
  return REWARD_CATALOG.filter((reward) => xp >= reward.unlockXp);
}

export function rewardUnlocked(xp: number, id: string): boolean {
  return REWARD_CATALOG.some((reward) => reward.id === id && xp >= reward.unlockXp);
}

export function sanitizeMaterial(value: unknown): RewardMaterial {
  return value === "pastel" || value === "brick" || value === "tile" ? value : "wood";
}

export function sanitizeTheme(value: unknown): RewardTheme {
  return value === "museum" || value === "sky" ? value : "blueprint";
}

export function appearanceKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function sanitizeAppearance(value: unknown): Record<string, RewardMaterial> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, RewardMaterial> = {};
  for (const [key, material] of Object.entries(value as Record<string, unknown>)) {
    if (/^-?\d+,-?\d+,-?\d+$/.test(key)) result[key] = sanitizeMaterial(material);
  }
  return result;
}
