import {
  Baby, Banknote, Beer, BookOpen, Briefcase, Car, CircleHelp, Coffee, Film, Flame, Gift, House, Landmark, Lightbulb,
  Package, Palette, PiggyBank, Plane, Receipt, School, Shield, Shirt, ShoppingBasket, Smartphone, Sofa, Stethoscope,
  TrainFront, TrendingUp, Wallet, Wifi, Gamepad2, Droplet, type LucideIcon,
} from 'lucide-react';

// 費目名（保存値）には絵文字が含まれる。保存値は変えず、表示名と線アイコンを別に対応付ける。
const EMOJI_PREFIX = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|️|‍)+\s*/u;
export const displayName = (himoku: string) => himoku.replace(EMOJI_PREFIX, '') || himoku;

const RULES: [RegExp, LucideIcon][] = [
  [/食費/, ShoppingBasket], [/外食|カフェ/, Coffee], [/日用品/, Package], [/こども|学童|児童/, Baby],
  [/衣服|美容/, Shirt], [/娯楽/, Gamepad2], [/交際/, Beer], [/医療/, Stethoscope], [/交通/, TrainFront],
  [/立替/, Briefcase], [/住居/, House], [/電気/, Lightbulb], [/ガス/, Flame], [/水道/, Droplet],
  [/ネット/, Wifi], [/携帯|通信/, Smartphone], [/自己投資|情報/, BookOpen], [/習い事/, Palette], [/学/, School],
  [/保険/, Shield], [/税/, Landmark], [/旅行|帰省/, Plane], [/ギフト|お祝い/, Gift], [/家具|家電/, Sofa],
  [/駐車|車/, Car], [/小遣い/, Wallet], [/NISA|投資/, TrendingUp], [/貯金|予備|積立/, PiggyBank],
  [/給与|賞与|手当|収入|配当|副業/, Banknote], [/返済|債務|奨学金|年会費/, Receipt], [/映画/, Film],
];
export function iconFor(himoku: string): LucideIcon {
  return RULES.find(([re]) => re.test(himoku))?.[1] ?? CircleHelp;
}

export const yen = (n: number) => (n < 0 ? '−' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');

export const KUBUN_LABEL: Record<string, string> = {
  '支出（変動費）': '変動費', '支出（固定費）': '固定費', '支出（特別費）': '特別費', '先取り貯金・投資': '貯金・投資', '収入': '収入',
};
