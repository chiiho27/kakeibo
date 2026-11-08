import { describe, expect, it } from 'vitest';
import { evaluate, formatExpr, press } from './calc';

const type = (keys: string[]) => keys.reduce(press, '');

describe('電卓', () => {
  it('掛け算・割り算を先に計算し、円単位に丸める', () => {
    expect(evaluate('1280+300×2')).toBe(1880);
    expect(evaluate('1000−200÷3')).toBe(933);
  });
  it('末尾の演算子は無視し、0で割ると計算不可', () => {
    expect(evaluate('500+')).toBe(500);
    expect(evaluate('5÷0')).toBeNull();
    expect(evaluate('')).toBe(0);
  });
  it('演算子の連続は置き換え、先頭の0と演算子は入らない', () => {
    expect(type(['5', '+', '×', '2'])).toBe('5×2');
    expect(type(['0', '00', '7'])).toBe('7');
    expect(type(['+', '3'])).toBe('3');
  });
  it('＝で結果に置き換わり、消す・全消去ができる', () => {
    expect(type(['1', '2', '+', '3', '='])).toBe('15');
    expect(type(['1', '2', 'back'])).toBe('1');
    expect(type(['1', 'clear'])).toBe('');
  });
  it('1つの数は9桁まで', () => {
    expect(type(Array(12).fill('1'))).toBe('111111111');
  });
  it('表示は桁区切り', () => {
    expect(formatExpr('1280+300')).toBe('1,280+300');
  });
});
