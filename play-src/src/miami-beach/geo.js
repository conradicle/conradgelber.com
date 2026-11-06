export const ORIGIN = [-80.135, 25.815];
export const SCALE_X = 111320 * Math.cos(ORIGIN[1] * Math.PI / 180);
export const SCALE_Y = 111320;
export function project([lon, lat]) { return [(lon-ORIGIN[0])*SCALE_X, (ORIGIN[1]-lat)*SCALE_Y]; }
export function unproject([x,z]) { return [x/SCALE_X+ORIGIN[0], ORIGIN[1]-z/SCALE_Y]; }
export function tileKey([x,z], size=650) { return `${Math.floor(x/size)}_${Math.floor(z/size)}`; }
export function heightFor(properties, floors=0) {
  // HEIGHT is preserved for inspection, but its source unit is undocumented.
  // Do not silently treat it as feet or metres.
  // The city inventory contains implausible 80/90-floor records. Exclude
  // those outliers rather than drawing fictional supertall towers.
  if (floors > 0 && floors <= 60) return {height:Math.max(3.2, floors*3.2), heightSource:'city-floor-estimate'};
  return {height:6.4, heightSource:'fallback-estimate'};
}
export const palettes = {
  deco:['#f5e8d2','#d8ece3','#edc4bb','#d3e4e9','#f0dca8'],
  modern:['#d5e3e4','#ece6d8','#b9d2d4','#e5e9df'],
  residential:['#e7ddca','#e4cbbd','#d8e1d2','#f0e8d9'],
};
// AI-authored interpretation, not a classification of a building's actual style.
export function styleFor(id, lat, height) {
  const family = height>28 ? 'modern' : lat<25.795 ? 'deco' : 'residential';
  const colors = palettes[family];
  return {family, color:colors[Math.abs(Number(id)||0)%colors.length]};
}
