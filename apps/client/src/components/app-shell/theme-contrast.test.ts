import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const stylesheet = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
const rootTokens = stylesheet.slice(stylesheet.indexOf(':root {'), stylesheet.indexOf('.dark {'))
const darkTokens = stylesheet.slice(stylesheet.indexOf('.dark {'), stylesheet.indexOf('html,'))

function token(source: string, name: string) {
  const value = new RegExp(`--${name}:\\s*(#[a-fA-F0-9]{6})`).exec(source)?.[1]
  if (value === undefined) throw new Error(`Missing hexadecimal token --${name}`)
  return value
}

function rgb(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((value) => Number.parseInt(value, 16) / 255)
  if (channels === undefined || channels.length !== 3) throw new Error(`Invalid color: ${hex}`)
  return channels as [number, number, number]
}

function luminance(hex: string) {
  const [red, green, blue] = rgb(hex).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(left: string, right: string) {
  const values = [luminance(left), luminance(right)].toSorted((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

function composite(foreground: string, background: string, opacity: number) {
  const left = rgb(foreground)
  const right = rgb(background)
  const channels = left.map((value, index) => Math.round((value * opacity + right[index] * (1 - opacity)) * 255))
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

describe('app theme contrast contract', () => {
  test('keeps production dark surfaces and secondary text readable', () => {
    const background = token(darkTokens, 'background')
    const card = token(darkTokens, 'card')
    expect(contrast(token(darkTokens, 'foreground'), background)).toBeGreaterThanOrEqual(7)
    expect(contrast(token(darkTokens, 'muted-foreground'), card)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token(darkTokens, 'input'), card)).toBeGreaterThanOrEqual(3)
  })

  test('keeps production light controls and tinted status text readable', () => {
    const canvas = token(rootTokens, 'brand-cream')
    const success = token(rootTokens, 'success-readable')
    expect(contrast(token(rootTokens, 'input'), '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(contrast(token(rootTokens, 'brand-readable'), canvas)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token(rootTokens, 'destructive-readable'), canvas)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(success, composite(success, canvas, 0.18))).toBeGreaterThanOrEqual(4.5)
  })
})
