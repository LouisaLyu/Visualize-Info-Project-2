const CITIES = {
  Oakville: { latitude: 43.4675, longitude: -79.6877 },        // Oakville
  "Downtown Toronto": { latitude: 43.6532, longitude: -79.3832 },    // Downtown Toronto
  Burlington: { latitude: 43.3255, longitude: -79.7990 },
  Hamilton: { latitude: 43.2557, longitude: -79.8711 },
  Markham: { latitude: 43.8561, longitude: -79.3370 },
  Mississauga: { latitude: 43.5890, longitude: -79.6441 },
  "North York": { latitude: 43.7615, longitude: -79.4111 },
  Scarborough: { latitude: 43.7764, longitude: -79.2318 }
};

const RANGE_OPTIONS = [
  { key: "today", label: "Today", forecastDays: 2 },
  { key: "7d", label: "Next 7 Days", forecastDays: 7 },
  { key: "14d", label: "Next 14 Days", forecastDays: 14 }
];

const METRICS = {
  temperature: {
    label: "Temperature",
    unit: "°C",
    hourlyKey: "temperature_2m",
    aggregate: "avg"
  },
  precipitation: {
    label: "Precipitation",
    unit: "mm",
    hourlyKey: "precipitation",
    aggregate: "sum"
  },
  wind: {
    label: "Wind Speed",
    unit: "km/h",
    hourlyKey: "wind_speed_10m",
    aggregate: "avg"
  },
  cloud: {
    label: "Cloud Cover",
    unit: "%",
    hourlyKey: "cloud_cover",
    aggregate: "avg"
  }
};

const state = {
  primaryCity: "Oakville",
  compareCity: "Campus",
  range: "today",
  metric: "temperature",
  weatherData: {},
  forecastDaysLoaded: 0,
  chart: null
};

const primaryCitySelect = document.getElementById("primaryCity");
const compareCitySelect = document.getElementById("compareCity");
const rangeButtons = document.getElementById("rangeButtons");
const metricButtons = document.getElementById("metricButtons");
const refreshBtn = document.getElementById("refreshBtn");
const summaryCards = document.getElementById("summaryCards");
const chartTitle = document.getElementById("chartTitle");
const chartSubtitle = document.getElementById("chartSubtitle");
const compareLabel = document.getElementById("compareLabel");
const forecastTable = document.getElementById("forecastTable");
const lastUpdated = document.getElementById("lastUpdated");
const errorBox = document.getElementById("errorBox");
const loadingBox = document.getElementById("loadingBox");

const rainDecision = document.getElementById("rainDecision");
const rainReason = document.getElementById("rainReason");
const layerDecision = document.getElementById("layerDecision");
const layerReason = document.getElementById("layerReason");
const harderLocation = document.getElementById("harderLocation");
const harderReason = document.getElementById("harderReason");

function init() {
  populateCitySelects();
  renderRangeButtons();
  renderMetricButtons();

  primaryCitySelect.addEventListener("change", handlePrimaryCityChange);
  compareCitySelect.addEventListener("change", handleCompareCityChange);
  refreshBtn.addEventListener("click", loadWeather);

  loadWeather();
}

function populateCitySelects() {
  const cityNames = Object.keys(CITIES);

  primaryCitySelect.innerHTML = cityNames
    .map(city => `<option value="${city}">${city}</option>`)
    .join("");

  renderCompareCityOptions();

  primaryCitySelect.value = state.primaryCity;
  compareCitySelect.value = state.compareCity;
}

function renderCompareCityOptions() {
  const compareChoices = Object.keys(CITIES).filter(
    city => city !== state.primaryCity
  );

  if (!compareChoices.includes(state.compareCity)) {
    state.compareCity = compareChoices[0];
  }

  compareCitySelect.innerHTML = compareChoices
    .map(city => `<option value="${city}">${city}</option>`)
    .join("");
}

function renderRangeButtons() {
  rangeButtons.innerHTML = RANGE_OPTIONS.map(option => {
    const activeClass = option.key === state.range ? "active" : "";
    return `<button class="pill-btn ${activeClass}" data-range="${option.key}">${option.label}</button>`;
  }).join("");

  rangeButtons.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      state.range = button.dataset.range;
      renderRangeButtons();
      const neededDays = getForecastDays();
      if (state.forecastDaysLoaded < neededDays) {
        loadWeather();
      } else {
        updateDashboard();
      }
    });
  });
}

function renderMetricButtons() {
  metricButtons.innerHTML = Object.entries(METRICS)
    .map(([key, config]) => {
      const activeClass = key === state.metric ? "active" : "";
      return `<button class="pill-btn ${activeClass}" data-metric="${key}">${config.label}</button>`;
    })
    .join("");

  metricButtons.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      state.metric = button.dataset.metric;
      renderMetricButtons();
      updateDashboard();
    });
  });
}

function handlePrimaryCityChange(event) {
  state.primaryCity = event.target.value;
  renderCompareCityOptions();
  compareCitySelect.value = state.compareCity;
  loadWeather();
}

function handleCompareCityChange(event) {
  state.compareCity = event.target.value;
  loadWeather();
}

function getForecastDays() {
  return RANGE_OPTIONS.find(option => option.key === state.range)?.forecastDays || 7;
}

async function fetchWeather(cityName, forecastDays) {
  const city = CITIES[cityName];

  const params = new URLSearchParams({
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    hourly: "temperature_2m,precipitation,wind_speed_10m,cloud_cover",
    current: "temperature_2m,precipitation,wind_speed_10m,cloud_cover",
    timezone: "auto",
    forecast_days: String(forecastDays)
  });

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Weather request failed for ${cityName}.`);
  }

  return response.json();
}

async function loadWeather() {
  showLoading(true);
  showError("");

  try {
    const forecastDays = getForecastDays();

    const [primaryPayload, comparePayload] = await Promise.all([
      fetchWeather(state.primaryCity, forecastDays),
      fetchWeather(state.compareCity, forecastDays)
    ]);

    state.weatherData[state.primaryCity] = primaryPayload;
    state.weatherData[state.compareCity] = comparePayload;
    state.forecastDaysLoaded = forecastDays;

    lastUpdated.textContent = new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date());

    updateDashboard();
  } catch (error) {
    showError(error.message || "Something went wrong while loading weather data.");
  } finally {
    showLoading(false);
  }
}

function updateDashboard() {
  const primaryPayload = state.weatherData[state.primaryCity];
  const comparePayload = state.weatherData[state.compareCity];

  if (!primaryPayload || !comparePayload) return;

  renderDecisionCards(primaryPayload, comparePayload);
  renderSummaryCards(primaryPayload);
  renderChart(primaryPayload, comparePayload);
  renderForecastTable(primaryPayload);
  renderChartLabels();
}

function renderDecisionCards(primaryPayload, comparePayload) {
  const p = primaryPayload.current;
  const c = comparePayload.current;

  const rainMax = Math.max(p.precipitation, c.precipitation);
  const colderTemp = Math.min(p.temperature_2m, c.temperature_2m);
  const windMax = Math.max(p.wind_speed_10m, c.wind_speed_10m);

  if (rainMax >= 1) {
    rainDecision.textContent = "Recommended";
    rainReason.textContent = "At least one location is showing noticeable precipitation.";
  } else if (rainMax > 0) {
    rainDecision.textContent = "Maybe";
    rainReason.textContent = "Light precipitation is present, so a compact umbrella could help.";
  } else {
    rainDecision.textContent = "Not needed";
    rainReason.textContent = "Current precipitation is very low across the selected locations.";
  }

  if (colderTemp <= 5 || windMax >= 18) {
    layerDecision.textContent = "Yes";
    layerReason.textContent = "Cooler temperatures or stronger wind may make the commute less comfortable.";
  } else if (colderTemp <= 10 || windMax >= 10) {
    layerDecision.textContent = "Maybe";
    layerReason.textContent = "Conditions are mild, but an extra layer could still help outdoors.";
  } else {
    layerDecision.textContent = "Probably not";
    layerReason.textContent = "Both selected locations look fairly comfortable right now.";
  }

  const primaryScore = getDiscomfortScore(p);
  const compareScore = getDiscomfortScore(c);

  if (Math.abs(primaryScore - compareScore) < 2) {
    harderLocation.textContent = "Fairly similar";
    harderReason.textContent = `${state.primaryCity} and ${state.compareCity} feel relatively close right now.`;
  } else if (primaryScore > compareScore) {
    harderLocation.textContent = state.primaryCity;
    harderReason.textContent = `${state.primaryCity} currently looks less comfortable because of combined wind, rain, or temperature conditions.`;
  } else {
    harderLocation.textContent = state.compareCity;
    harderReason.textContent = `${state.compareCity} currently looks less comfortable because of combined wind, rain, or temperature conditions.`;
  }
}

function getDiscomfortScore(current) {
  let score = 0;
  score += current.precipitation * 3;
  score += Math.max(0, current.wind_speed_10m - 8) * 0.4;
  score += Math.max(0, 10 - current.temperature_2m) * 0.5;
  return score;
}

function renderSummaryCards(payload) {
  const cards = [
    {
      label: "Current temperature",
      value: payload.current.temperature_2m,
      unit: "°C"
    },
    {
      label: "Current precipitation",
      value: payload.current.precipitation,
      unit: "mm"
    },
    {
      label: "Current wind speed",
      value: payload.current.wind_speed_10m,
      unit: "km/h"
    },
    {
      label: "Current cloud cover",
      value: payload.current.cloud_cover,
      unit: "%"
    }
  ];

  summaryCards.innerHTML = cards
    .map(card => {
      return `
        <article class="card summary-card">
          <span class="summary-label">${card.label}</span>
          <div class="summary-value">
            ${formatNumber(card.value)}<span class="summary-unit">${card.unit}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderChartLabels() {
  const metricConfig = METRICS[state.metric];
  chartTitle.textContent = `${metricConfig.label} for ${state.primaryCity}`;

  chartSubtitle.textContent =
    state.range === "today"
      ? "Hourly view for near-term commute and campus decisions"
      : `Daily view for the next ${state.range === "7d" ? 7 : 14} days`;

  compareLabel.textContent = `${state.primaryCity} compared with ${state.compareCity}`;
}

function renderChart(primaryPayload, comparePayload) {
  const primarySeries = buildChartSeries(primaryPayload, state.metric, state.range);
  const compareSeries = buildChartSeries(comparePayload, state.metric, state.range);
  const metricConfig = METRICS[state.metric];

  const labels = primarySeries.map(item => item.label);
  const primaryValues = primarySeries.map(item => item.value);
  const compareValues = compareSeries.map(item => item.value);

  const ctx = document.getElementById("weatherChart").getContext("2d");

  if (state.chart) {
    state.chart.destroy();
  }

  const chartType = state.metric === "precipitation" ? "bar" : "line";

  state.chart = new Chart(ctx, {
    type: chartType,
    data: {
      labels,
      datasets: [
        {
          label: state.primaryCity,
          data: primaryValues,
          borderColor: "#0f172a",
          backgroundColor:
            state.metric === "cloud"
              ? "rgba(124, 58, 237, 0.15)"
              : state.metric === "precipitation"
              ? "rgba(15, 23, 42, 0.9)"
              : "rgba(15, 23, 42, 0.9)",
          tension: 0.35,
          fill: state.metric === "cloud",
          borderWidth: 3
        },
        {
          label: state.compareCity,
          data: compareValues,
          borderColor: "#64748b",
          backgroundColor: "rgba(100, 116, 139, 0.3)",
          tension: 0.35,
          fill: false,
          borderWidth: 2.5,
          borderDash: [6, 4]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: {
          labels: {
            usePointStyle: true,
            boxWidth: 10,
            color: "#334155",
            font: {
              family: "Inter",
              weight: "600"
            }
          }
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${formatNumber(context.raw)} ${metricConfig.unit}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: "#64748b",
            font: {
              family: "Inter"
            }
          }
        },
        y: {
          beginAtZero: state.metric === "precipitation",
          grid: {
            color: "#e2e8f0"
          },
          ticks: {
            color: "#64748b",
            font: {
              family: "Inter"
            }
          }
        }
      }
    }
  });
}

function renderForecastTable(payload) {
  const series = buildChartSeries(payload, state.metric, state.range);
  const metricConfig = METRICS[state.metric];
  const visibleRows =
    state.range === "today"
      ? series.slice(0, 8)
      : state.range === "7d"
      ? series.slice(0, 7)
      : series.slice(0, 10);

  forecastTable.innerHTML = visibleRows
    .map(row => {
      return `
        <div class="table-row">
          <span>${row.label}</span>
          <span>${formatNumber(row.value)} ${metricConfig.unit}</span>
        </div>
      `;
    })
    .join("");
}

function buildChartSeries(payload, metricKey, rangeKey) {
  if (!payload || !payload.hourly) return [];

  const metric = METRICS[metricKey];
  const times = payload.hourly.time || [];
  const values = payload.hourly[metric.hourlyKey] || [];

  if (rangeKey === "today") {
    return times.slice(0, 24).map((time, index) => ({
      label: getHourLabel(time),
      value: values[index]
    }));
  }

  const maxDays = rangeKey === "7d" ? 7 : 14;
  const byDay = new Map();

  times.forEach((time, index) => {
    const day = time.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(values[index]);
  });

  return Array.from(byDay.entries())
    .slice(0, maxDays)
    .map(([day, dayValues]) => ({
      label: getDayLabel(day),
      value:
        metric.aggregate === "sum"
          ? dayValues.reduce((sum, value) => sum + value, 0)
          : average(dayValues)
    }));
}

function getHourLabel(timestamp) {
  return timestamp.slice(11, 16);
}

function getDayLabel(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function showError(message) {
  if (!message) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    return;
  }

  errorBox.classList.remove("hidden");
  errorBox.textContent = message;
}

function showLoading(isLoading) {
  loadingBox.classList.toggle("hidden", !isLoading);
}

init();