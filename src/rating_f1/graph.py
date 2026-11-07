"""Граф напарников: кто с кем ездил, насколько надёжно связаны оценки, пути сравнения.

Узлы — пилоты, рёбра — пары напарников. Сила связи — число гонок вместе, где подменные
выступления (до 3 гонок за команду в сезоне) считаются за половину: ровно с этими весами
сравнения входят в модели напарников.

Надёжность сравнения считается как в электрической цепи, где каждая совместная гонка —
проводник: в модели на разницах с напарником погрешность сравнения двух пилотов
пропорциональна эффективному сопротивлению между ними. Много сильных параллельных путей —
сопротивление низкое, сравнение надёжное. Величина 1 / сопротивление читается как
«столько гонок прямой дуэли стоит это сравнение через всю сеть».
"""
from __future__ import annotations

import networkx as nx
import numpy as np
import pandas as pd

from .features.stints import SHORT_STINT_RACES, SHORT_STINT_WEIGHT

KEY = ["season", "round"]
WEAK_LINK_RACES = 3
LAYOUT_W, LAYOUT_H = 1000.0, 700.0  # «холст» раскладки; страница вписывает его в своё окно
LABEL_ROOM = 16.0                   # запас вокруг узла под подпись и воздух, в единицах холста


def node_size(starts: int, max_starts: int) -> float:
    """Диаметр узла на странице: от 10 до 30 пикселей по числу гонок."""
    return 10.0 + 20.0 * float(np.sqrt(max(starts, 1) / max(max_starts, 1)))


def spread_layout(xy: np.ndarray, sizes: np.ndarray, iterations: int = 800) -> np.ndarray:
    """Раздвинуть узлы, чтобы они не налезали друг на друга, почти не меняя общую раскладку.

    Узлы считаются кругами радиусом «половина размера + запас под подпись». Пока круги
    пересекаются, их расталкивает; слабая пружина тянет каждый узел к исходному месту.
    """
    base = xy.copy()
    p = xy + np.random.default_rng(0).normal(0, 1e-3, xy.shape)
    radius = sizes / 2 + LABEL_ROOM
    need = radius[:, None] + radius[None, :]
    np.fill_diagonal(need, 0)
    for _ in range(iterations):
        diff = p[:, None, :] - p[None, :, :]
        dist = np.sqrt((diff ** 2).sum(axis=-1))
        np.fill_diagonal(dist, 1.0)
        overlap = np.clip(need - dist, 0, None)
        if overlap.max() < 0.5:
            break
        p += 0.5 * ((diff / dist[..., None]) * (overlap / 2)[..., None]).sum(axis=1)
        p += 0.02 * (base - p)
    return p


def _race_pairs(results: pd.DataFrame, starts: dict) -> pd.DataFrame:
    race = results[results["session"] == "R"][KEY + ["driver_id", "constructor_id"]]
    pairs = race.merge(race, on=KEY + ["constructor_id"], suffixes=("_a", "_b"))
    pairs = pairs[pairs["driver_id_a"] < pairs["driver_id_b"]].rename(
        columns={"driver_id_a": "a", "driver_id_b": "b"})
    shortest = [min(starts.get((int(s), t, a), 0), starts.get((int(s), t, b), 0))
                for s, t, a, b in zip(pairs["season"], pairs["constructor_id"], pairs["a"], pairs["b"])]
    pairs["strength"] = np.where(np.array(shortest) <= SHORT_STINT_RACES, SHORT_STINT_WEIGHT, 1.0)
    return pairs


def _h2h(qp: pd.DataFrame, rd: pd.DataFrame, pp: pd.DataFrame) -> dict:
    """Личные счета пары (a < b по алфавиту): квала, гонки, медианный гэп темпа."""
    out: dict = {}
    q = qp[qp["valid"]]
    for (a, b), g in q.groupby(["driver_a", "driver_b"]):
        out.setdefault((a, b), {})["quali"] = [int((g["gap_pct"] < 0).sum()), int((g["gap_pct"] > 0).sum())]
    r = rd[rd["valid"] & (rd["session"] == "R")]
    for (a, b), g in r.groupby(["driver_a", "driver_b"]):
        out.setdefault((a, b), {})["race"] = [int((g["outcome"] == 1).sum()), int((g["outcome"] == 0).sum())]
    p = pp[pp["valid"]]
    for (a, b), g in p.groupby(["driver_a", "driver_b"]):
        out.setdefault((a, b), {})["pace"] = [round(float(g["gap_pct"].median()), 3), int(len(g))]
    return out


def build_graph(results: pd.DataFrame, constructors: pd.DataFrame, qp: pd.DataFrame, rd: pd.DataFrame,
                pp: pd.DataFrame, period: pd.DataFrame, starts: dict) -> dict:
    """Узлы, рёбра, раскладка и метрики графа для сайта.

    period — общий рейтинг за весь период (индекс — пилот; столбцы rating, rank, starts).
    """
    names = constructors.set_index("constructor_id")["constructor_name"].to_dict()
    pairs = _race_pairs(results, starts)
    grouped = pairs.groupby(["a", "b"])
    edges_df = pd.DataFrame({
        "races": grouped.size(),
        "strength": grouped["strength"].sum(),
        "seasons": grouped["season"].agg(lambda s: sorted({int(x) for x in s})),
        "teams": grouped["constructor_id"].agg(lambda s: list(dict.fromkeys(names.get(x, x) for x in s))),
    }).reset_index()
    h2h = _h2h(qp, rd, pp)

    graph = nx.Graph()
    for rec in edges_df.to_dict("records"):
        graph.add_edge(rec["a"], rec["b"], weight=rec["strength"])
    nodes = sorted(graph.nodes)
    n = len(nodes)

    positions = nx.kamada_kawai_layout(graph)  # по числу шагов, без весов: структура читается лучше
    xy = np.array([positions[v] for v in nodes])
    xy = (xy - xy.min(axis=0)) / np.ptp(xy, axis=0) * [LAYOUT_W, LAYOUT_H]
    period_starts = {v: int(period.loc[v, "starts"]) if v in period.index else 1 for v in nodes}
    max_starts = max(period_starts.values())
    sizes = np.array([node_size(period_starts[v], max_starts) for v in nodes])
    xy = spread_layout(xy, sizes) / [LAYOUT_W, LAYOUT_H]

    laplacian = nx.laplacian_matrix(graph, nodelist=nodes, weight="weight").toarray().astype(float)
    pinv = np.linalg.pinv(laplacian)
    diag = np.diag(pinv)
    resistance = diag[:, None] + diag[None, :] - 2 * pinv
    mean_r = resistance.sum(axis=1) / (n - 1)
    reliability = 100 * mean_r.min() / mean_r
    with np.errstate(divide="ignore"):
        eq_races = np.where(np.eye(n, dtype=bool), np.nan, 1.0 / resistance)

    cut_off = {}
    for v in nx.articulation_points(graph):
        rest = graph.copy()
        rest.remove_node(v)
        parts = sorted(len(c) for c in nx.connected_components(rest))
        cut_off[v] = int(sum(parts[:-1]))

    hops = dict(nx.all_pairs_shortest_path_length(graph))
    distances = [d for src in hops.values() for d in src.values() if d > 0]

    node_rows = []
    for i, v in enumerate(nodes):
        incident = [graph.edges[v, u] for u in graph.neighbors(v)]
        rec = period.loc[v] if v in period.index else None
        node_rows.append({
            "id": v,
            "x": float(xy[i, 0]),
            "y": float(xy[i, 1]),
            "size": round(float(sizes[i]), 1),
            "teammates": graph.degree(v),
            "races_with_mates": int(edges_df.loc[(edges_df["a"] == v) | (edges_df["b"] == v), "races"].sum()),
            "strength": float(sum(e["weight"] for e in incident)),
            "reliability": float(reliability[i]),
            "bridge_cut": cut_off.get(v, 0),
            "rating": None if rec is None else float(rec["rating"]),
            "rank": None if rec is None or pd.isna(rec["rank"]) else int(rec["rank"]),
            "starts": None if rec is None else int(rec["starts"]),
        })

    edge_rows = []
    for rec in edges_df.to_dict("records"):
        item = {
            "a": rec["a"], "b": rec["b"], "races": int(rec["races"]), "strength": float(rec["strength"]),
            "seasons": rec["seasons"], "teams": rec["teams"], "weak": bool(rec["races"] <= WEAK_LINK_RACES),
        }
        item.update(h2h.get((rec["a"], rec["b"]), {}))
        edge_rows.append(item)

    return {
        "nodes": node_rows,
        "edges": edge_rows,
        "order": nodes,
        "eq_races": [[None if np.isnan(x) else round(float(x), 1) for x in row] for row in eq_races],
        "stats": {
            "drivers": n,
            "pairs": len(edge_rows),
            "components": nx.number_connected_components(graph),
            "diameter": int(max(distances)),
            "mean_hops": round(float(np.mean(distances)), 2),
            "weak_pairs": int(sum(e["weak"] for e in edge_rows)),
            "weak_races": WEAK_LINK_RACES,
        },
    }
