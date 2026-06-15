#!/usr/bin/env node
"use strict";
/*
 * Dünya Kupası 2026 sonuçlarını football-data.org API'sinden çekip
 * index.html ile aynı klasöre "results.json" olarak yazar.
 *
 * Neden bu script? API tarayıcıdan (chronos.al) CORS nedeniyle çağrılamaz ve
 * API anahtarı istemciye konulamaz. Bu yüzden veriyi SUNUCU TARAFINDA bu script
 * çeker; index.html sadece statik results.json dosyasını okur.
 *
 * Kullanım:
 *   FOOTBALL_DATA_TOKEN=API_ANAHTARINIZ node fetch-results.js
 *
 * Node 18+ gereklidir (yerleşik fetch kullanır).
 */

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
if (!TOKEN) {
  console.error("HATA: FOOTBALL_DATA_TOKEN ortam değişkeni tanımlı değil.");
  console.error("Örnek: FOOTBALL_DATA_TOKEN=xxxxx node fetch-results.js");
  process.exit(1);
}

const BASE = "https://api.football-data.org/v4";
const SEASON = process.env.WC_SEASON || "2026";
const OUT_FILE = path.join(__dirname, "results.json");

/** API'ye GET isteği; başarısızsa anlamlı hata fırlatır. */
async function api(endpoint) {
  const res = await fetch(BASE + endpoint, { headers: { "X-Auth-Token": TOKEN } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${endpoint} -> HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Bir skor çiftini [home, away] olarak döndürür; ikisi de boşsa null. */
function pair(obj) {
  if (!obj) return null;
  if (obj.home == null && obj.away == null) return null;
  return [obj.home, obj.away];
}

/** API maç nesnesini sade, küçük bir kayda indirger. */
function mapMatch(m) {
  const s = m.score || {};
  return {
    utcDate: m.utcDate,                       // birincil eşleştirme anahtarı
    status: m.status,                         // FINISHED, IN_PLAY, TIMED ...
    stage: m.stage || null,
    group: m.group || null,
    home: (m.homeTeam && m.homeTeam.name) || null,
    away: (m.awayTeam && m.awayTeam.name) || null,
    winner: s.winner || null,                 // HOME_TEAM | AWAY_TEAM | DRAW
    duration: s.duration || null,             // REGULAR | EXTRA_TIME | PENALTY_SHOOTOUT
    ft: pair(s.fullTime),                     // tam zaman (uzatma dahil) skoru
    ht: pair(s.halfTime),                     // ilk yarı skoru
    pen: pair(s.penalties)                    // penaltı atışları (varsa)
  };
}

/** Standings yanıtını gruplara indirger (yalnızca TOTAL tabloları). */
function mapStandings(data) {
  const groups = (data.standings || []).filter(s => s.type === "TOTAL" && s.group);
  return groups.map(g => ({
    group: g.group,
    table: (g.table || []).map(r => ({
      pos: r.position,
      team: (r.team && r.team.name) || null,
      played: r.playedGames,
      won: r.won,
      draw: r.draw,
      lost: r.lost,
      gf: r.goalsFor,
      ga: r.goalsAgainst,
      gd: r.goalDifference,
      points: r.points
    }))
  }));
}

(async function main() {
  const out = { updatedAt: new Date().toISOString(), season: SEASON, matches: [], standings: [] };

  // 1) Maçlar (sezon parametresiyle; başarısızsa parametresiz tekrar dene)
  let matchesData;
  try {
    matchesData = await api(`/competitions/WC/matches?season=${SEASON}`);
  } catch (e) {
    console.warn("Sezonlu maç çağrısı başarısız, parametresiz deneniyor:", e.message);
    matchesData = await api("/competitions/WC/matches");
  }
  out.matches = (matchesData.matches || []).map(mapMatch);
  const finished = out.matches.filter(m => m.status === "FINISHED").length;
  console.log(`Maç: ${out.matches.length} (tamamlanan: ${finished})`);

  // 2) Puan durumu (ücretsiz planda kapalı olabilir → hatayı yut, boş bırak)
  try {
    const st = await api(`/competitions/WC/standings?season=${SEASON}`);
    out.standings = mapStandings(st);
    console.log(`Grup tablosu: ${out.standings.length}`);
  } catch (e) {
    console.warn("Puan durumu alınamadı (planınızda kapalı olabilir):", e.message);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log("Yazıldı:", OUT_FILE);
})().catch(e => {
  console.error("Beklenmeyen hata:", e.message);
  process.exit(1);
});
