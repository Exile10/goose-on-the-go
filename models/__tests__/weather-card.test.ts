/**
 * Reading the weather card's payload: which card it is, and when it is none.
 *
 * The payloads are the shapes `pond-mcp-server/src/weather.rs` builds, so a
 * change there that renames a field fails here rather than on a phone as a
 * place name over a sun.
 */

import { conditionIcon, dayLabel, rangeEnd, readWeatherCard } from '../weather-card';

/** What `get_current_weather` sends under `[[[mcp-ui:weather:…]]]`. */
const CURRENT = {
  location: 'Nairobi, Kenya',
  temperature: 19.2,
  feels_like: 20.4,
  condition: 'Mainly clear',
  humidity: 78,
  wind_speed: 8.1,
  wind_gusts: 14,
  cloud_cover: 20,
  precipitation: 0,
  is_day: true,
  sunrise: '06:21',
  sunset: '18:33',
};

function day(date: string, extra: Record<string, unknown> = {}) {
  return {
    date,
    description: 'Slight rain',
    temp_max_c: 24.6,
    temp_min_c: 13.1,
    precipitation_sum_mm: 2.4,
    precipitation_probability_pct: 60,
    wind_speed_max_kmh: 18,
    uv_index_max: 9.5,
    sunrise: '06:21',
    sunset: '18:33',
    ...extra,
  };
}

/** What `get_weather_forecast` sends for the seven days the A57 asked about. */
const WEEK = {
  location: 'Nairobi, Kenya',
  forecast: ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'].map(
    (d) => day(d),
  ),
};

describe('readWeatherCard', () => {
  it('reads a current reading as the current card', () => {
    expect(readWeatherCard(CURRENT)).toEqual({
      kind: 'current',
      location: 'Nairobi, Kenya',
      temperature: 19.2,
      condition: 'Mainly clear',
      feelsLike: 20.4,
      humidity: 78,
      wind: 8.1,
      isDay: true,
    });
  });

  it('reads a forecast as the forecast card, every day in order', () => {
    const card = readWeatherCard(WEEK);
    expect(card?.kind).toBe('forecast');
    if (card?.kind !== 'forecast') return;
    expect(card.location).toBe('Nairobi, Kenya');
    expect(card.days.map((d) => d.iso)).toEqual(WEEK.forecast.map((d) => d.date));
    expect(card.days[0]).toMatchObject({ condition: 'Slight rain', high: 24.6, low: 13.1, rainChance: 60 });
  });

  it('never reads a forecast as a reading, even one with a location and nothing else usable', () => {
    // The bug: the forecast payload was drawn as a reading, which had only its location.
    expect(readWeatherCard({ location: 'Nairobi, Kenya', forecast: [] })).toBeNull();
    expect(readWeatherCard({ location: 'Nairobi, Kenya', forecast: [{ date: 'soon' }, null, 3] })).toBeNull();
  });

  it('is nothing for a payload that holds nothing to draw', () => {
    expect(readWeatherCard({})).toBeNull();
    expect(readWeatherCard({ location: 'Nairobi, Kenya' })).toBeNull();
    expect(readWeatherCard({ location: 'Nairobi, Kenya', temperature: 'warm', condition: '  ' })).toBeNull();
  });

  it('draws a partial reading with what it has', () => {
    expect(readWeatherCard({ condition: 'Overcast' })).toMatchObject({
      kind: 'current',
      temperature: null,
      condition: 'Overcast',
      feelsLike: null,
      isDay: null,
    });
    expect(readWeatherCard({ temperature: 0 })).toMatchObject({ kind: 'current', temperature: 0, condition: '' });
  });

  it('drops days it cannot read, days with nothing in them, and repeats', () => {
    const card = readWeatherCard({
      location: 'Kisumu',
      forecast: [
        day('2026-10-27'),
        day('2026-10-27', { temp_max_c: 99 }),
        day('2026-02-31'),
        day('27/10/2026'),
        { date: '2026-10-29' },
        day('2026-10-30', { temp_max_c: null, temp_min_c: 'cold', description: '', precipitation_probability_pct: 'NaN' }),
        day('2026-10-31', { temp_max_c: Number.NaN, precipitation_probability_pct: null }),
      ],
    });
    expect(card?.kind).toBe('forecast');
    if (card?.kind !== 'forecast') return;
    expect(card.days.map((d) => d.iso)).toEqual(['2026-10-27', '2026-10-31']);
    expect(card.days[0].high).toBe(24.6);
    expect(card.days[1]).toMatchObject({ high: null, low: 13.1, rainChance: null });
  });

  it('reads a forecast date as that calendar day on this phone, not midnight UTC', () => {
    const card = readWeatherCard({ forecast: [day('2026-11-02')] });
    if (card?.kind !== 'forecast') throw new Error('expected a forecast');
    const date = card.days[0].date;
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 10, 2, 0]);
  });
});

describe('conditionIcon', () => {
  it.each([
    ['Clear sky', 'sun'],
    ['Mainly clear', 'sun'],
    ['Partly cloudy', 'partly-sunny'],
    ['Overcast', 'cloud'],
    ['Fog', 'fog'],
    ['Light drizzle', 'drizzle'],
    ['Freezing drizzle', 'drizzle'],
    ['Slight rain', 'rain'],
    ['Freezing rain', 'rain'],
    ['Moderate showers', 'rain'],
    ['Heavy snow', 'snow'],
    ['Snow showers', 'snow'],
    ['Snow grains', 'snow'],
    ['Thunderstorm', 'storm'],
    ['Thunderstorm with hail', 'storm'],
    ['Unknown', 'cloud'],
    ['', 'cloud'],
  ])('draws %p as %p', (condition, icon) => {
    expect(conditionIcon(condition)).toBe(icon);
  });

  it('draws a clear night as the moon and a partly cloudy one without the sun', () => {
    expect(conditionIcon('Clear sky', false)).toBe('moon');
    expect(conditionIcon('Partly cloudy', false)).toBe('cloud');
    expect(conditionIcon('Slight rain', false)).toBe('rain');
  });
});

describe('day labels', () => {
  const tuesday = new Date(2026, 9, 27);

  it('name the weekday and the date', () => {
    expect(dayLabel(tuesday, 'en-US')).toBe('Tue, Oct 27');
    expect(rangeEnd(tuesday, 'en-US')).toBe('Oct 27');
  });

  it('follow the language they are given', () => {
    expect(dayLabel(tuesday, 'de-DE')).toBe('Di., 27. Okt.');
  });
});
