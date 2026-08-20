"""最終レポート(Markdown)を組み立てる。"""

from __future__ import annotations

from typing import Any, Dict, List


def _h(level: int, text: str) -> str:
    return f"{'#' * level} {text}\n"


def build_report(cfg_name: str, values: Dict[str, Any], audience: Dict[str, Any],
                 timeline: Dict[str, Any], matches: Dict[str, Any],
                 actions: Dict[str, Any]) -> str:
    L: List[str] = []
    product = values.get("product", {})
    L.append(_h(1, f"ツイ廃マーケター分析レポート — {product.get('name', cfg_name)}"))
    L.append(f"> {product.get('description', '')}\n")
    L.append(f"- 抽出手法: value=`{values.get('method')}`, audience=`{audience.get('method')}`\n")

    # 1. 価値要素
    L.append(_h(2, "1. 価値要素 (Value Elements)"))
    if values.get("positioning"):
        L.append(f"**ポジショニング**: {values['positioning']}\n")
    L.append("| 重要度 | 価値 | 種別 | 片づける用事 | キーワード |")
    L.append("|---|---|---|---|---|")
    for e in values.get("value_elements", []):
        kw = ", ".join(e.get("keywords", [])[:5])
        L.append(f"| {e.get('weight')} | {e.get('value')} | {e.get('type')} | "
                 f"{e.get('job_to_be_done','')} | {kw} |")
    L.append("")

    # 2. オーディエンス
    L.append(_h(2, "2. オーディエンス層 (Segments)"))
    L.append(f"サンプリング目標: **{audience.get('sample_size')} 件** / {len(audience.get('segments', []))} 層\n")
    for s in audience.get("segments", []):
        L.append(_h(3, f"{s.get('id')} — {s.get('name')}（{s.get('sample_quota')}件）"))
        L.append(f"- 誰: {s.get('who','')}")
        L.append(f"- なぜ価値を欲する: {s.get('why_needs_value','')}")
        L.append(f"- X検索クエリ: `{s.get('x_search_query','')}`")
        L.append(f"- Grokクエリ: {s.get('grok_query','')}\n")

    # 3. タイムライン予測
    L.append(_h(2, "3. タイムライン予測 (What flows on their timeline)"))
    for s in timeline.get("segments", []):
        L.append(_h(3, f"{s.get('name')}（分析対象 {s.get('n_posts',0)} 投稿）"))
        if not s.get("n_posts"):
            L.append(f"_{s.get('note','データ不足')}_\n")
            continue
        topics = ", ".join(t["term"] for t in s.get("top_topics", [])[:12])
        L.append(f"- 頻出トピック: {topics}")
        base = s.get("engagement_baseline", {})
        if base:
            L.append(f"- エンゲージ中央値: like {base.get('likes',{}).get('median')}, "
                     f"RT {base.get('retweets',{}).get('median')}, "
                     f"reply {base.get('replies',{}).get('median')} / メディアリフト x{base.get('media_lift')}")
        L.append("- コンテンツの型:")
        for a in s.get("content_archetypes", [])[:5]:
            L.append(f"  - {a['archetype']}: {int(a['share']*100)}% / 平均{a['avg_engagement']}エンゲージ")
        L.append("- TLに流れる既存ツイート(予測):")
        for pt in s.get("predicted_timeline", [])[:6]:
            L.append(f"  - [{pt.get('kind')}] {pt.get('theme')} — {pt.get('why_surfaces','')}")
            if pt.get("example_style"):
                L.append(f"    > {pt['example_style']}")
        L.append("")

    # 4. 自ツイートマッチ
    L.append(_h(2, "4. 自アカウントとの類似マッチ (Your tweets that fit)"))
    cov = matches.get("coverage", {})
    if cov:
        L.append(f"自ツイート {cov.get('own_posts_total')} 件中 {cov.get('own_posts_matched')} 件が"
                 f"いずれかの層に刺さる（カバー率 {int(cov.get('match_rate',0)*100)}%）\n")
    for s in matches.get("segments", []):
        L.append(_h(3, f"{s.get('name')}（平均類似度 {s.get('avg_top_similarity',0)}）"))
        for m in s.get("matches", [])[:5]:
            hit = ", ".join(m.get("topics_hit", [])[:5])
            L.append(f"- sim **{m['similarity']}** / {m.get('own_engagement')}eng — {m['text']}")
            if hit:
                L.append(f"  - 一致語: {hit}")
        if not s.get("matches"):
            L.append("- （刺さる自ツイートなし → この層向けの発信が不足）")
        L.append("")

    # 5. アクション
    L.append(_h(2, "5. 表示率アップのアクション (Actions to increase reach)"))
    diag = actions.get("own_diagnosis", {})
    if diag and "n_posts" in diag:
        L.append(f"**自アカウント診断**: メディア率 {int(diag.get('media_ratio',0)*100)}%, "
                 f"リンク率 {int(diag.get('link_ratio',0)*100)}%, "
                 f"会話喚起率 {int(diag.get('conversation_starter_ratio',0)*100)}%, "
                 f"平均エンゲージ {diag.get('avg_engagement')}\n")
    L.append("### アルゴリズム観点の全体アクション")
    for a in actions.get("global_actions", []):
        L.append(f"- **{a['action']}**（効果:{a['expected_impact']} / signal:{a['algo_signal']}）")
        L.append(f"  - なぜ: {a['why']}")
        L.append(f"  - どう: {a['how']}")
    L.append("")
    L.append("### 層別アクション")
    for s in actions.get("per_segment_actions", []):
        L.append(f"- **{s.get('name')}**: 伸びる型=「{s.get('peak_archetype')}」 / フック語={', '.join(s.get('hook_topics', [])[:5])}")
        L.append(f"  - {s.get('recommended_angle','')}")
        for p in s.get("your_best_fit_posts", [])[:2]:
            L.append(f"  - 起点にできる自ツイート(sim {p['similarity']}): {p['text'][:80]}")
    L.append("")

    strat = actions.get("llm_strategy") or {}
    if isinstance(strat, dict) and strat.get("content_calendar"):
        L.append("### コンテンツカレンダー（AI 提案）")
        L.append("| 曜日 | 層 | フォーマット | ツイート案 |")
        L.append("|---|---|---|---|")
        for c in strat["content_calendar"][:10]:
            L.append(f"| {c.get('day','')} | {c.get('segment','')} | {c.get('format','')} | {c.get('tweet_idea','')} |")
        L.append("")
        if strat.get("kpi_to_watch"):
            L.append("**見るべきKPI**: " + ", ".join(strat["kpi_to_watch"]))
        if strat.get("risks"):
            L.append("**リスク**: " + ", ".join(strat["risks"]))
        L.append("")

    L.append("---")
    L.append("_Generated by tsuihai-marketer. ツイート収集は nob さんの "
             "[x-audience-research-kit](https://github.com/nobphotographr/x-audience-research-kit) を利用。_")
    return "\n".join(L) + "\n"
