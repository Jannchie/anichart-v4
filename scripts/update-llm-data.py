#!/usr/bin/env python3
"""重新生成 LMArena 系列示例数据（llm*.csv）。

文字总榜（llm.csv）的口径：
- 2025-08-14（含）之前：data/llm-legacy.csv —— 旧版 LMSYS leaderboard space 的历史
  快照。官方新数据集重写了早期榜单（claude-v1 / gpt-3.5 / gpt-4 等老模型整段缺失），
  所以这一段冻结在仓库里，只做公司名归一化与模型名美化。
- 之后：HuggingFace lmarena-ai/leaderboard-dataset 的 text/full parquet
  （category=overall）。同一 (日期, 模型) 出现多个榜单变体时，取投票数最大的
  那行（与历史序列连续）；每 (日期, 公司) 取评分最高的模型。
- 最后追加 arena.ai 实时榜单作为最新一帧。

其它品类（WebDev/Vision/Search/文生图）走同一条 parquet+实时 管线，只输出到
playground。Agent 榜没有历史数据集，用 Wayback Machine 的每日存档 + 实时页拼出
短历史（score 为对战胜率，输出时 ×100 当百分比用）。

输出列：company,model,rating,date（date 为 Unix 秒；company 为展示名，同时是
logo 文件名；model 为易读名，不含括号注记）。

用法：
  python3 scripts/update-llm-data.py            # 重新生成全部 csv
  python3 scripts/update-llm-data.py --names    # 只打印模型名映射，便于校对
  python3 scripts/update-llm-data.py --logos    # 下载公司 logo 到 apps/*/public/logos

依赖：pyarrow（--logos 需要 curl）。
"""
from __future__ import annotations

import csv
import datetime
import io
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LEGACY_CSV = Path(__file__).resolve().parent / 'data' / 'llm-legacy.csv'
LEGACY_CUTOFF = '2025-08-14'  # legacy 覆盖到这一天（含）
PARQUET_URL = ('https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/'
               'resolve/main/{}/full-00000-of-00001.parquet')
# arena.ai（LMArena 新站）的实时榜单，比 HF 数据集的定期快照更新
LIVE_URL = 'https://arena.ai/leaderboard/{}'
PLAYGROUND = REPO / 'apps/playground/public'

# 各品类：parquet 目录（HF 数据集）、arena.ai 实时榜 slug、输出文件。
# 文字总榜还要拼 legacy 段，并同步到 studio / web 两个 app。
CATEGORIES = {
    'text': {
        'parquet': 'text', 'live': 'text',
        'outputs': [
            PLAYGROUND / 'llm.csv',
            REPO / 'apps/studio/public/llm.csv',
            REPO / 'apps/web/public/samples/sample-llm.csv',
        ],
        'legacy': True,
    },
    'webdev': {'parquet': 'webdev', 'live': 'code',
               'outputs': [PLAYGROUND / 'llm-webdev.csv']},
    'vision': {'parquet': 'vision', 'live': 'vision',
               'outputs': [PLAYGROUND / 'llm-vision.csv']},
    'search': {'parquet': 'search', 'live': 'search',
               'outputs': [PLAYGROUND / 'llm-search.csv']},
    'text_to_image': {'parquet': 'text_to_image', 'live': 'text-to-image',
                      'outputs': [PLAYGROUND / 'llm-t2i.csv']},
}
AGENT_OUTPUT = PLAYGROUND / 'llm-agent.csv'
LOGO_DIRS = [
    REPO / 'apps/playground/public/logos',
    REPO / 'apps/studio/public/logos',
]

# ── organization → 展示名（也是配色 / logo 的 key）──
ORG_DISPLAY = {
    # 新数据集 slug
    'openai': 'OpenAI', 'google': 'Google', 'anthropic': 'Anthropic', 'meta': 'Meta',
    'microsoft': 'Microsoft', 'microsoft-ai': 'Microsoft', 'alibaba': 'Alibaba',
    'mistral': 'Mistral AI', 'deepseek': 'DeepSeek', 'xai': 'xAI', 'cohere': 'Cohere',
    'nvidia': 'NVIDIA', 'tencent': 'Tencent', 'amazon': 'Amazon', 'ibm': 'IBM',
    'zai': 'Z.ai', 'moonshot': 'Moonshot AI', 'minimax': 'MiniMax', 'stepfun': 'StepFun',
    'baidu': 'Baidu', 'bytedance': 'ByteDance', 'xiaomi': 'Xiaomi', 'meituan': 'Meituan',
    'ant-group': 'Ant Group', 'inception-ai': 'Inception AI', 'allenai': 'AI2',
    # arena.ai 实时榜单的写法
    'Mistral': 'Mistral AI', 'Nvidia': 'NVIDIA', 'Z.ai': 'Z.ai',
    'Ant Group': 'Ant Group', 'Baidu': 'Baidu', 'Xiaomi': 'Xiaomi',
    'Meituan': 'Meituan', 'Inception AI': 'Inception AI', 'StepFun': 'StepFun',
    # webdev / vision / search / 文生图 品类新增的组织
    'KwaiKAT': 'Kuaishou', 'Aliaba': 'Alibaba',  # Aliaba 是数据源里的拼写错误
    'LLaVA': 'LLaVA', 'OpenBMB': 'OpenBMB', 'OpenGVLab': 'OpenGVLab',
    'Perplexity': 'Perplexity AI', 'perplexity': 'Perplexity AI', 'diffbot': 'Diffbot',
    'Microsoft AI': 'Microsoft',
    'bfl': 'Black Forest Labs', 'hidream': 'HiDream', 'ideogram': 'Ideogram',
    'krea': 'Krea', 'leonardo-ai': 'Leonardo AI', 'luma-ai': 'Luma AI',
    'recraft': 'Recraft', 'reve': 'Reve', 'runway': 'Runway', 'Pruna': 'Pruna AI',
    # 新数据集混用的大小写变体
    'Bytedance': 'ByteDance', 'Zhipu': 'Z.ai', 'Zhipu AI': 'Z.ai',
    'Ai2': 'AI2', 'AllenAI/UW': 'AI2', 'UW': 'AI2',
    'NexusFlow': 'Nexusflow', 'NousResearch': 'Nous Research',
    'HuggingFace': 'Hugging Face', 'Upstage AI': 'Upstage',
    '01 AI': '01.AI',
    # 原样保留
    'AI21 Labs': 'AI21 Labs', 'Arcee AI': 'Arcee AI',
    'Cognitive Computations': 'Cognitive Computations', 'Databricks': 'Databricks',
    'InternLM': 'InternLM', 'LMSYS': 'LMSYS', 'MosaicML': 'MosaicML',
    'Nexusflow': 'Nexusflow', 'Nomic AI': 'Nomic AI', 'OpenAssistant': 'OpenAssistant',
    'OpenChat': 'OpenChat', 'Prime Intellect': 'Prime Intellect', 'Princeton': 'Princeton',
    'RWKV': 'RWKV', 'Reka AI': 'Reka AI', 'Snowflake': 'Snowflake',
    'Stability AI': 'Stability AI', 'Stanford': 'Stanford', 'TII': 'TII',
    'Together AI': 'Together AI', 'Tsinghua': 'Tsinghua', 'UC Berkeley': 'UC Berkeley',
    # legacy csv 里已是展示名的公司（恒等映射）
    'OpenAI': 'OpenAI', 'Google': 'Google', 'Anthropic': 'Anthropic', 'Meta': 'Meta',
    'Microsoft': 'Microsoft', 'Alibaba': 'Alibaba', 'Mistral AI': 'Mistral AI',
    'DeepSeek': 'DeepSeek', 'xAI': 'xAI', 'Cohere': 'Cohere', 'NVIDIA': 'NVIDIA',
    'Tencent': 'Tencent', 'Amazon': 'Amazon', 'IBM': 'IBM', 'MiniMax': 'MiniMax',
    'Nous Research': 'Nous Research',
    # legacy csv 里的旧名
    'Allen Institute': 'AI2', 'Berkeley': 'UC Berkeley', 'BlinkDL': 'RWKV',
    'Cohere for AI': 'Cohere', 'LAION': 'OpenAssistant', 'Moonshot': 'Moonshot AI',
    'Shanghai AI Laboratory': 'InternLM', 'Step': 'StepFun', 'WizardTeam': 'Microsoft',
    'Perplexity AI': 'Perplexity AI', '01.AI': '01.AI', 'Upstage': 'Upstage',
}

# organization 为空 / Unknown 时按模型前缀归属
ORG_BY_MODEL_PREFIX = [
    ('dola-seed', 'ByteDance'),
    ('intellect', 'Prime Intellect'),
    ('olmo', 'AI2'),
    ('smollm', 'Hugging Face'),
    ('stripedhyena', 'Together AI'),
]

# ── 模型 slug → 易读名：先查覆盖表，没有再走规则 ──
MODEL_OVERRIDES = {
    'RWKV-4-Raven-14B': 'RWKV-4 Raven 14B',
    'amazon-nova-experimental-chat-05-14': 'Nova Experimental',
    'amazon-nova-experimental-chat-10-09': 'Nova Experimental',
    'amazon-nova-experimental-chat-10-20': 'Nova Experimental',
    'amazon-nova-experimental-chat-11-10': 'Nova Experimental',
    'amazon-nova-experimental-chat-12-10': 'Nova Experimental',
    'amazon-nova-experimental-chat-26-02-10': 'Nova Experimental',
    'amazon-nova-pro-v1.0': 'Nova Pro',
    'athene-70b': 'Athene 70B',
    'athene-v2-chat': 'Athene v2',
    'alpaca-13b': 'Alpaca 13B',
    'bard-jan-24-gemini-pro': 'Bard',
    'c4ai-aya-expanse-32b': 'Aya Expanse 32B',
    'chatglm2-6b': 'ChatGLM2 6B',
    'chatglm3-6b': 'ChatGLM3 6B',
    'chatgpt-4o-latest': 'ChatGPT-4o',
    'chatgpt-4o-latest-2024-08-08': 'ChatGPT-4o',
    'chatgpt-4o-latest-20240903': 'ChatGPT-4o',
    'chatgpt-4o-latest-20241120': 'ChatGPT-4o',
    'chatgpt-4o-latest-20250129': 'ChatGPT-4o',
    'chatgpt-4o-latest-20250326': 'ChatGPT-4o',
    'claude-1': 'Claude 1',
    'claude-v1': 'Claude v1',
    'command-a-03-2025': 'Command A',
    'command-r': 'Command R',
    'command-r-plus': 'Command R+',
    'command-r-plus-08-2024': 'Command R+',
    'dbrx-instruct': 'DBRX',
    'dbrx-instruct-preview': 'DBRX',
    'deepseek-llm-67b-chat': 'DeepSeek 67B',
    'deepseek-v2-api-0628': 'DeepSeek V2',
    'dolly-v2-12b': 'Dolly v2 12B',
    'dolphin-2.2.1-mistral-7b': 'Dolphin 2.2.1 7B',
    'early-grok-3': 'Grok 3',
    'falcon-180b-chat': 'Falcon 180B',
    'gemini-advanced-0514': 'Gemini Advanced',
    'gemini-pro-dev-api': 'Gemini Pro',
    'gemini-1.5-pro-002': 'Gemini 1.5 Pro',
    'gemini-1.5-pro-api-0409-preview': 'Gemini 1.5 Pro',
    'gemini-1.5-pro-api-0514': 'Gemini 1.5 Pro',
    'gemini-2.0-flash-001': 'Gemini 2.0 Flash',
    'gemini-2.0-pro-exp-02-05': 'Gemini 2.0 Pro Exp',
    'gemini-2.5-pro-exp-03-25': 'Gemini 2.5 Pro Exp',
    'gemini-2.5-pro-preview-05-06': 'Gemini 2.5 Pro Preview',
    'gemini-2.5-pro-preview-06-05': 'Gemini 2.5 Pro Preview',
    'gemini-2.5-flash-lite-preview-06-17-thinking': 'Gemini 2.5 Flash-Lite',
    'gemma-2-9b-it-simpo': 'Gemma 2 9B',
    'gpt-4-0125-preview': 'GPT-4 Turbo',
    'gpt-4-1106-preview': 'GPT-4 Turbo',
    'gpt-4-turbo-2024-04-09': 'GPT-4 Turbo',
    'gpt-4.5-preview-2025-02-27': 'GPT-4.5 Preview',
    'gpt-4o-2024-05-13': 'GPT-4o',
    'gpt-5.2-chat-latest-20260210': 'GPT-5.2 Chat',
    'gpt4all-13b-snoozy': 'GPT4All 13B',
    'granite-4.1-8b': 'Granite 4.1 8B',
    'grok-2-2024-08-13': 'Grok 2',
    'grok-3-preview-02-24': 'Grok 3 Preview',
    'grok-4.20-beta1': 'Grok 4.20 Beta',
    'grok-4.20-beta-0309-reasoning': 'Grok 4.20 Beta',
    'guanaco-33b': 'Guanaco 33B',
    'hunyuan-large-2025-02-10': 'Hunyuan Large',
    'hunyuan-standard-256k': 'Hunyuan Standard',
    'hunyuan-turbos-20250226': 'Hunyuan TurboS',
    'hunyuan-turbos-20250416': 'Hunyuan TurboS',
    'ibm-granite-h-small': 'Granite H Small',
    'intellect-3': 'INTELLECT-3',
    'internlm2_5-20b-chat': 'InternLM2.5 20B',
    'koala-13b': 'Koala 13B',
    'llama2-70b-steerlm-chat': 'Llama 2 70B SteerLM',
    'llama-3.1-405b-instruct-bf16': 'Llama 3.1 405B',
    'llama-3.1-405b-instruct-fp8': 'Llama 3.1 405B',
    'llama-3.1-nemotron-70b-instruct': 'Llama 3.1 Nemotron 70B',
    'llama-3.1-nemotron-ultra-253b-v1': 'Nemotron Ultra 253B',
    'llama-3.1-tulu-3-70b': 'Tulu 3 70B',
    'llama-3.3-nemotron-49b-super-v1': 'Nemotron Super 49B',
    'llama-4-maverick-03-26-experimental': 'Llama 4 Maverick Exp',
    'llama-4-maverick-17b-128e-instruct': 'Llama 4 Maverick',
    'longcat-flash-chat-2602-exp': 'LongCat Flash Exp',
    'mai-1-preview': 'MAI-1 Preview',
    'mimo-v2-flash (non-thinking)': 'MiMo V2 Flash',
    'mistral-7b-instruct': 'Mistral 7B',
    'mistral-large-2402': 'Mistral Large',
    'mistral-large-2407': 'Mistral Large',
    'mistral-medium-2505': 'Mistral Medium',
    'mistral-medium-2508': 'Mistral Medium',
    'mixtral-8x7b-instruct-v0.1': 'Mixtral 8x7B',
    'mpt-7b-chat': 'MPT 7B',
    'mpt-30b-chat': 'MPT 30B',
    'nemotron-4-340b-instruct': 'Nemotron-4 340B',
    'nous-hermes-2-mixtral-8x7b-dpo': 'Nous Hermes 2 8x7B',
    'nvidia-llama-3.3-nemotron-super-49b-v1.5': 'Nemotron Super 49B v1.5',
    'nvidia-nemotron-3-nano-30b-a3b-bf16': 'Nemotron 3 Nano 30B',
    'nvidia-nemotron-3-super-120b-a12b': 'Nemotron 3 Super 120B',
    'nvidia-nemotron-3-ultra-550b-a55b-nvfp4': 'Nemotron 3 Ultra 550B',
    'o1-preview': 'o1-preview',
    'o1-2024-12-17': 'o1',
    'o3-2025-04-16': 'o3',
    'oasst-pythia-12b': 'OpenAssistant Pythia 12B',
    'olmo-3-32b-think': 'OLMo 3 32B',
    'openhermes-2.5-mistral-7b': 'OpenHermes 2.5 7B',
    'palm-2': 'PaLM 2',
    'phi-3-medium-4k-instruct': 'Phi-3 Medium',
    'phi-3-mini-128k-instruct': 'Phi-3 Mini',
    'phi-3-mini-4k-instruct': 'Phi-3 Mini',
    'phi-4': 'Phi-4',
    'pplx-70b-online': 'PPLX 70B',
    'qwen-max-2025-01-25': 'Qwen Max',
    'qwen3-235b-a22b-instruct-2507': 'Qwen3 235B',
    'qwen3-235b-a22b-no-thinking': 'Qwen3 235B',
    'qwen3-235b-a22b-thinking-2507': 'Qwen3 235B',
    'reka-flash-21b-20240226-online': 'Reka Flash 21B',
    'smollm2-1.7b-instruct': 'SmolLM2 1.7B',
    'snowflake-arctic-instruct': 'Arctic',
    'solar-10.7b-instruct-v1.0': 'Solar 10.7B',
    'stablelm-tuned-alpha-7b': 'StableLM Alpha 7B',
    'starling-lm-7b-alpha': 'Starling 7B Alpha',
    'starling-lm-7b-beta': 'Starling 7B Beta',
    'stripedhyena-nous-7b': 'StripedHyena Nous 7B',
    'tulu-2-dpo-70b': 'Tulu 2 70B',
    'yi-large-preview': 'Yi Large Preview',
    'zephyr-orpo-141b-A35b-v0.1': 'Zephyr ORPO 141B',
}

# 词例外：默认 capitalize，这里列出固定写法；映射为空串的词直接丢弃
WORD_CASE = {
    'gpt': 'GPT', 'chatgpt': 'ChatGPT', 'glm': 'GLM', 'chatglm': 'ChatGLM',
    'ernie': 'ERNIE', 'palm': 'PaLM', 'llama': 'Llama', 'olmo': 'OLMo',
    'mpt': 'MPT', 'dbrx': 'DBRX', 'rwkv': 'RWKV', 'wizardlm': 'WizardLM',
    'openchat': 'OpenChat', 'openhermes': 'OpenHermes', 'stablelm': 'StableLM',
    'internlm': 'InternLM', 'minimax': 'MiniMax', 'mimo': 'MiMo',
    'longcat': 'LongCat', 'deepseek': 'DeepSeek', 'qwen': 'Qwen',
    'yi': 'Yi', 'kimi': 'Kimi', 'grok': 'Grok', 'gemini': 'Gemini',
    'gemma': 'Gemma', 'claude': 'Claude', 'mistral': 'Mistral',
    'mixtral': 'Mixtral', 'hunyuan': 'Hunyuan', 'nemotron': 'Nemotron',
    'phi': 'Phi', 'granite': 'Granite', 'jamba': 'Jamba', 'athene': 'Athene',
    'vicuna': 'Vicuna', 'koala': 'Koala', 'zephyr': 'Zephyr', 'tulu': 'Tulu',
    'dola': 'Dola', 'doubao': 'Doubao', 'step': 'Step', 'ling': 'Ling',
    'muse': 'Muse', 'mercury': 'Mercury', 'trinity': 'Trinity', 'nova': 'Nova',
    'hy3': 'HY3', 'turbos': 'TurboS', 'exp': 'Exp', 'dpo': 'DPO',
    'amazon': '', 'instruct': '', 'chat': '', 'it': '', 'hf': '',
    'experimental': 'Experimental', 'preview': 'Preview', 'beta': 'Beta',
    'alpha': 'Alpha', 'latest': '', 'online': '', 'plus': 'Plus',
    'max': 'Max', 'pro': 'Pro', 'flash': 'Flash', 'lite': 'Lite',
    'mini': 'Mini', 'nano': 'Nano', 'turbo': 'Turbo', 'large': 'Large',
    'medium': 'Medium', 'small': 'Small', 'ultra': 'Ultra', 'super': 'Super',
    'core': 'Core', 'advanced': 'Advanced', 'standard': 'Standard',
    'lightning': 'Lightning', 'vision': 'Vision', 'coder': 'Coder',
    'think': 'Think', 'spark': 'Spark', 'seed': 'Seed',
    'fable': 'Fable', 'opus': 'Opus', 'sonnet': 'Sonnet', 'haiku': 'Haiku',
    # vision / 文生图 / webdev 品类常见词
    'flux': 'FLUX', 'imagen': 'Imagen', 'seedream': 'Seedream',
    'seededit': 'SeedEdit', 'llava': 'LLaVA', 'minicpm': 'MiniCPM',
    'internvl': 'InternVL', 'pixtral': 'Pixtral', 'molmo': 'Molmo',
    'vl': 'VL', 'qvq': 'QVQ', 'wan': 'Wan', 'kolors': 'Kolors',
    'lumina': 'Lumina', 'janus': 'Janus', 'sana': 'Sana', 'photon': 'Photon',
    'firefly': 'Firefly', 'dall': 'DALL', 'kat': 'KAT',
    'ppl': '', 'sonar': 'Sonar', 'mai': 'MAI', 'xl': 'XL',
}

DATE_TOKEN = re.compile(r'^(\d{8}|\d{6}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}(-\d{2})?|\d{2}-\d{4})$')
MMDD = re.compile(r'^(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$')
SIZE = re.compile(r'^(\d+(?:\.\d+)?)(x\d+)?b$', re.IGNORECASE)
ACTIVE_SIZE = re.compile(r'^a\d+(\.\d+)?b$', re.IGNORECASE)
QUANT = re.compile(r'^(bf16|fp8|nvfp4|4k|8k|16k|32k|128k|256k|128e)$', re.IGNORECASE)


def pretty_model(slug: str) -> str:
    if slug in MODEL_OVERRIDES:
        return MODEL_OVERRIDES[slug]

    # slug 里的括号注记（(non-thinking) / (codex-harness) 等）直接丢弃
    name = re.sub(r'\s*\([^)]*\)\s*', '', slug).strip()
    # 尾部完整日期（-2026-04-22）会被 '-' 分词拆碎，先整体剥掉
    name = re.sub(r'-20\d{2}-\d{2}-\d{2}$', '', name)
    for pat in [
        r'-thinking-\d+k$', r'-thinking-turbo$', r'-no-thinking$',
        r'-thinking$', r'-reasoning$', r'-x?high$',
    ]:
        m = re.search(pat, name)
        if m:
            name = name[: m.start()]
            break

    tokens = name.split('-')
    out: list[str] = []
    for i, tok in enumerate(tokens):
        low = tok.lower()
        if DATE_TOKEN.match(tok) and (i == len(tokens) - 1 or all(
                DATE_TOKEN.match(t) or t.lower() in ('preview', 'exp', 'online') for t in tokens[i:])):
            continue  # 尾部日期戳
        if MMDD.match(tok) and i >= 2:
            continue
        if ACTIVE_SIZE.match(tok) or QUANT.match(tok):
            continue
        sm = SIZE.match(tok)
        if sm:
            out.append(f'{sm.group(1)}{sm.group(2) or ""}B'.replace('X', 'x'))
            continue
        if re.match(r'^v?\d+(\.\d+)*$', low):
            # claude-3-5-sonnet / claude-opus-4-6 风格：相邻两个个位数并成 x.y
            if out and re.match(r'^\d$', out[-1]) and re.match(r'^\d$', low):
                out[-1] = f'{out[-1]}.{low}'
                continue
            out.append(tok.upper() if low.startswith('v') else tok)
            continue
        mapped = WORD_CASE.get(low)
        if mapped == '':
            continue
        out.append(mapped if mapped else tok.capitalize())

    label = ' '.join(out)
    # GPT-x / GLM-x / Phi-x 习惯用连字符
    label = re.sub(r'^(GPT|GLM|ChatGPT|Phi|MAI) (\d)', r'\1-\2', label)
    # 展示名里不留任何括号注记（圆括号、方括号都丢）
    label = re.sub(r'\s*[([][^)\]]*[)\]]', '', label).strip()
    return label


def resolve_org(org: str, model: str) -> str | None:
    if org in ('', 'Unknown'):
        for prefix, mapped in ORG_BY_MODEL_PREFIX:
            if model.startswith(prefix):
                return mapped
        return None
    # 映射表没有的组织原样保留（新品类常出现新公司），只是没配色 / logo
    return ORG_DISPLAY.get(org, org)


def load_legacy() -> list[dict]:
    rows = []
    unknown = set()
    for r in csv.DictReader(LEGACY_CSV.open()):
        org = resolve_org(r['company'], r['model'])
        if org is None:
            unknown.add(r['company'])
            continue
        rows.append({
            'company': org,
            'model': pretty_model(r['model']),
            'rating': round(float(r['rating']), 1),
            'date': int(float(r['date'])),
        })
    if unknown:
        print(f'legacy 未识别公司（已丢弃）: {sorted(unknown)}', file=sys.stderr)
    # 公司合并后同 (日期, 公司) 可能出现多行，保留评分最高的
    best: dict[tuple, dict] = {}
    for r in rows:
        k = (r['date'], r['company'])
        if k not in best or r['rating'] > best[k]['rating']:
            best[k] = r
    return list(best.values())


def load_current(parquet_dir: str, after: str = '') -> list[dict]:
    import pyarrow.parquet as pq

    url = PARQUET_URL.format(parquet_dir)
    cache = Path(f'/tmp/lmarena_{parquet_dir}.parquet')
    if not cache.exists():
        print(f'downloading {url} ...', file=sys.stderr)
        urllib.request.urlretrieve(url, cache)
    table = pq.read_table(cache)
    rows = [r for r in table.to_pylist() if r['category'] == 'overall'
            and r['leaderboard_publish_date'] > after]

    # 同一 (日期, 模型) 多榜单变体：投票数最大（其次评分最高）的那行延续时间序列
    dedup: dict[tuple, dict] = {}
    for r in rows:
        k = (r['leaderboard_publish_date'], r['model_name'])
        cur = dedup.get(k)
        key = (r['vote_count'] or 0, r['rating'])
        if cur is None or key > ((cur['vote_count'] or 0), cur['rating']):
            dedup[k] = r

    per: dict[tuple, dict] = {}
    unknown = set()
    for r in dedup.values():
        org = resolve_org(r['organization'] or '', r['model_name'])
        if org is None:
            if r['organization']:
                unknown.add(r['organization'])
            continue
        k = (r['leaderboard_publish_date'], org)
        if k not in per or r['rating'] > per[k]['rating']:
            per[k] = {**r, 'company': org}
    if unknown:
        print(f'新数据集未识别公司（已丢弃）: {sorted(unknown)}', file=sys.stderr)

    out = []
    for (date, org), r in per.items():
        ts = int(datetime.datetime.strptime(date, '%Y-%m-%d')
                 .replace(tzinfo=datetime.timezone.utc).timestamp())
        out.append({
            'company': org,
            'model': pretty_model(r['model_name']),
            'rating': round(r['rating'], 1),
            'date': ts,
        })
    return out


def fetch_entries(url: str) -> list[dict]:
    """取 arena.ai（或 Wayback 存档）页面内嵌 JSON 的第一个 entries 块。"""
    import json

    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req, timeout=60).read().decode('utf-8', 'replace')
    un = html.replace('\\"', '"')
    start = un.find('"entries":[')
    if start < 0:
        raise ValueError(f'页面结构变化，未找到 entries: {url}')
    # 模型名可能含 ]（如 FLUX1.1 [pro]），按字符串状态做括号匹配
    i = start + len('"entries":')
    depth = 0
    in_str = False
    for j in range(i, len(un)):
        ch = un[j]
        if in_str:
            if ch == '\\':
                continue
            if ch == '"' and un[j - 1] != '\\':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == '[':
            depth += 1
        elif ch == ']':
            depth -= 1
            if depth == 0:
                return json.loads(un[i:j + 1])
    raise ValueError(f'entries 数组未闭合: {url}')


def today_ts() -> int:
    today = datetime.datetime.now(datetime.timezone.utc).date()
    return int(datetime.datetime.combine(today, datetime.time(), datetime.timezone.utc).timestamp())


def load_live(live_slug: str, after_ts: int) -> list[dict]:
    """抓 arena.ai 实时榜单追加为最新一帧。"""
    ts = today_ts()
    if ts <= after_ts:
        return []
    try:
        entries = fetch_entries(LIVE_URL.format(live_slug))
    except (OSError, ValueError) as e:
        print(f'实时榜单({live_slug})抓取失败，跳过: {e}', file=sys.stderr)
        return []

    per: dict[str, dict] = {}
    for e in entries:
        org = resolve_org(e.get('modelOrganization') or '', e['modelDisplayName'])
        if org is None:
            continue
        if org not in per or e['rating'] > per[org]['rating']:
            per[org] = e

    return [{
        'company': org,
        'model': pretty_model(e['modelDisplayName']),
        'rating': round(e['rating'], 1),
        'date': ts,
    } for org, e in per.items()]


def load_agent() -> list[dict]:
    """Agent 榜没有历史数据集：用 Wayback 每日存档 + 实时页拼短历史。

    entries 是 contender 格式，score 为对战胜率（0-1），输出 ×100 当百分比。
    """
    import json

    cdx = ('http://web.archive.org/cdx/search/cdx?url=arena.ai/leaderboard/agent'
           '&output=json&collapse=timestamp:8&filter=statuscode:200&limit=200')
    try:
        snaps = json.loads(urllib.request.urlopen(cdx, timeout=60).read())[1:]
    except OSError as e:
        print(f'Wayback CDX 查询失败: {e}', file=sys.stderr)
        snaps = []

    out: list[dict] = []

    def add_frame(entries: list[dict], ts: int) -> None:
        per: dict[str, dict] = {}
        for e in entries:
            org = resolve_org(e.get('modelOrganization') or '', e.get('model') or '')
            if org is None:
                continue
            if org not in per or e['score'] > per[org]['score']:
                per[org] = e
        for org, e in per.items():
            model = re.sub(r'\s*\([^)]*\)', '', e['model']).strip()
            out.append({
                'company': org,
                'model': model,
                'rating': round(e['score'] * 100, 1),
                'date': ts,
            })

    seen_days = set()
    for snap in snaps:
        stamp = snap[1]
        day = stamp[:8]
        if day in seen_days:
            continue
        seen_days.add(day)
        cache = Path(f'/tmp/arena_agent_{stamp}.json')
        try:
            if cache.exists():
                entries = json.loads(cache.read_text())
            else:
                entries = fetch_entries(f'http://web.archive.org/web/{stamp}/https://arena.ai/leaderboard/agent')
                cache.write_text(json.dumps(entries))
        except (OSError, ValueError) as e:
            print(f'Wayback {stamp} 抓取失败，跳过: {e}', file=sys.stderr)
            continue
        ts = int(datetime.datetime.strptime(day, '%Y%m%d')
                 .replace(tzinfo=datetime.timezone.utc).timestamp())
        add_frame(entries, ts)

    last_ts = max((r['date'] for r in out), default=0)
    if today_ts() > last_ts:
        try:
            add_frame(fetch_entries(LIVE_URL.format('agent')), today_ts())
        except (OSError, ValueError) as e:
            print(f'Agent 实时榜抓取失败，跳过: {e}', file=sys.stderr)
    return out


# ── 公司 logo：lobehub 图标库优先（深色背景白色 glyph），缺的用 GitHub 组织头像 ──
LOBEHUB = 'https://unpkg.com/@lobehub/icons-static-png@latest/dark/{}.png'
GITHUB = 'https://github.com/{}.png?size=128'
LOGO_URLS = {
    'OpenAI': LOBEHUB.format('openai'),
    'Anthropic': LOBEHUB.format('anthropic'),
    'Google': LOBEHUB.format('google'),
    'Meta': LOBEHUB.format('meta'),
    'Microsoft': LOBEHUB.format('microsoft'),
    'Alibaba': LOBEHUB.format('alibaba'),
    'Mistral AI': LOBEHUB.format('mistral'),
    'DeepSeek': LOBEHUB.format('deepseek'),
    'xAI': LOBEHUB.format('xai'),
    'Cohere': LOBEHUB.format('cohere'),
    'NVIDIA': LOBEHUB.format('nvidia'),
    'Tencent': LOBEHUB.format('tencent'),
    'Amazon': GITHUB.format('aws'),
    'IBM': LOBEHUB.format('ibm'),
    'Z.ai': LOBEHUB.format('zai'),
    'Moonshot AI': LOBEHUB.format('moonshot'),
    'MiniMax': LOBEHUB.format('minimax'),
    'StepFun': LOBEHUB.format('stepfun'),
    'Baidu': LOBEHUB.format('baidu'),
    'ByteDance': LOBEHUB.format('bytedance'),
    'Xiaomi': GITHUB.format('xiaomi'),
    'Meituan': GITHUB.format('meituan'),
    'Ant Group': LOBEHUB.format('antgroup'),
    'Inception AI': GITHUB.format('inceptionlabs'),
    'AI2': LOBEHUB.format('ai2'),
    'AI21 Labs': LOBEHUB.format('ai21'),
    'Hugging Face': LOBEHUB.format('huggingface'),
    'Reka AI': GITHUB.format('reka-ai'),
    'Snowflake': LOBEHUB.format('snowflake'),
    'Stability AI': LOBEHUB.format('stability'),
    'Databricks': GITHUB.format('databricks'),
    'Nous Research': LOBEHUB.format('nousresearch'),
    'Together AI': LOBEHUB.format('together'),
    'Upstage': LOBEHUB.format('upstage'),
    'RWKV': LOBEHUB.format('rwkv'),
    'LMSYS': GITHUB.format('lm-sys'),
    'InternLM': LOBEHUB.format('internlm'),
    '01.AI': LOBEHUB.format('zeroone'),
    'Perplexity AI': LOBEHUB.format('perplexity'),
    'Nomic AI': GITHUB.format('nomic-ai'),
    'OpenAssistant': GITHUB.format('LAION-AI'),
    'Stanford': GITHUB.format('tatsu-lab'),
    'Tsinghua': GITHUB.format('THUDM'),
    'Nexusflow': GITHUB.format('nexusflowai'),
    'Prime Intellect': GITHUB.format('PrimeIntellect-ai'),
    'Cognitive Computations': GITHUB.format('cognitivecomputations'),
    'MosaicML': GITHUB.format('mosaicml'),
    'OpenChat': GITHUB.format('openchat'),
    'TII': LOBEHUB.format('tii'),
    'Arcee AI': LOBEHUB.format('arcee'),
    'UC Berkeley': GITHUB.format('berkeley'),
    # webdev / vision / search / 文生图 品类
    'Kuaishou': LOBEHUB.format('kling'),
    'LLaVA': LOBEHUB.format('llava'),
    'OpenBMB': GITHUB.format('OpenBMB'),
    'OpenGVLab': GITHUB.format('OpenGVLab'),
    'Diffbot': GITHUB.format('diffbot'),
    'Black Forest Labs': LOBEHUB.format('bfl'),
    'HiDream': GITHUB.format('HiDream-ai'),
    'Ideogram': LOBEHUB.format('ideogram'),
    'Krea': LOBEHUB.format('krea'),
    'Leonardo AI': GITHUB.format('Leonardo-Interactive'),
    'Luma AI': LOBEHUB.format('luma'),
    'Recraft': LOBEHUB.format('recraft'),
    'Reve': LOBEHUB.format('reve'),
    'Runway': LOBEHUB.format('runway'),
    'Pruna AI': GITHUB.format('PrunaAI'),
    # Artificial Analysis 榜单新增（scripts/update-aa-data.py）。China Mobile / Korea
    # Telecom 暂无可靠 logo 源，bar 回退显示公司名。
    'LG AI Research': GITHUB.format('LGAI-EXAONE'),
    'Liquid AI': LOBEHUB.format('liquid'),
    'LongCat': LOBEHUB.format('longcat'),
    'Motif Technologies': GITHUB.format('motif-technologies'),
    'Multiverse Computing': GITHUB.format('multiverse-computing'),
    'Nanbeige': GITHUB.format('Nanbeige'),
    'Sarvam': GITHUB.format('sarvamai'),
    'Swiss AI Initiative': GITHUB.format('swiss-ai'),
}


def download_logos() -> None:
    for d in LOGO_DIRS:
        d.mkdir(parents=True, exist_ok=True)
    primary, *mirrors = LOGO_DIRS
    for company, url in LOGO_URLS.items():
        dest = primary / f'{company}.png'
        if not dest.exists():
            subprocess.run(['curl', '-sfL', '-o', str(dest), url], check=True)
            print(f'downloaded {dest.name}')
        for m in mirrors:
            target = m / dest.name
            if not target.exists() or target.read_bytes() != dest.read_bytes():
                target.write_bytes(dest.read_bytes())


def write_rows(rows: list[dict], outputs: list[Path]) -> None:
    rows.sort(key=lambda r: (r['date'], -r['rating']))
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=['company', 'model', 'rating', 'date'])
    w.writeheader()
    w.writerows(rows)
    for path in outputs:
        path.write_text(buf.getvalue())
        print(f'wrote {len(rows)} rows -> {path.relative_to(REPO)}')


def main() -> None:
    if '--logos' in sys.argv:
        download_logos()
        return

    all_rows: list[dict] = []
    for cfg in CATEGORIES.values():
        rows = load_legacy() if cfg.get('legacy') else []
        rows += load_current(cfg['parquet'], LEGACY_CUTOFF if cfg.get('legacy') else '')
        rows += load_live(cfg['live'], max(r['date'] for r in rows))
        if '--names' in sys.argv:
            all_rows += rows
            continue
        write_rows(rows, cfg['outputs'])
    agent_rows = load_agent()
    if '--names' in sys.argv:
        seen = {}
        for r in all_rows + agent_rows:
            seen[(r['company'], r['model'])] = None
        for company, model in sorted(seen):
            print(f'{company:25s} {model}')
        return
    if agent_rows:
        write_rows(agent_rows, [AGENT_OUTPUT])


if __name__ == '__main__':
    main()
