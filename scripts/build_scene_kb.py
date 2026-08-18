# -*- coding: utf-8 -*-
"""
项目 Skill 知识生成器：skills/{key}/knowledge.jsonl

- 从全局知识库 assets/english_knowledge_base.jsonl 按 topic 白名单提取该 Skill 相关条目
- 追加每个 Skill 的补充条目（SCENE_EXTRA，A2 为主，聚焦该 Skill 的高频表达/常见错误）
- 重写 id 为 <skill_key>_NNNN（幂等，可重复运行；scene 字段标记 Skill 归属）

用法：cd backend-nest && python scripts/build_scene_kb.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLOBAL_KB = os.path.join(ROOT, "assets", "english_knowledge_base.jsonl")
SKILLS_DIR = os.path.join(ROOT, "skills")

# topic 白名单：从全局知识库中挑选属于该场景的条目
SCENE_TOPICS = {
    "daily_chat": [
        "daily_greetings", "daily_weather_smalltalk", "daily_catching_up",
        "daily_talking_about_job", "daily_daily_routine", "daily_hobbies_and_free_time",
        "daily_food_preferences",
        "natural_short_answers", "natural_keeping_conversation_going",
        "natural_surprise_expressions", "natural_soft_refusals",
        "natural_encouraging_phrases", "natural_vague_language",
        "natural_small_talk_compliments_weather",
    ],
    "shopping": [
        "daily_shopping_prices", "daily_trying_on_clothes", "speaking_shopping",
        "colloc_shopping", "chinglish_price_cheap", "speaking_complaining",
    ],
}


def c(topic, level, rule, examples, common_errors, tags, section="场景专属知识", chunk_type="pattern", summary=""):
    return {
        "topic": topic, "level": level, "rule": rule,
        "examples": examples, "common_errors": common_errors, "tags": tags,
        "section": section, "chunk_type": chunk_type, "summary": summary or topic.replace("_", " "),
    }


# 场景补充条目（A2 为主，只聚焦该场景，避免与全局库重复）
SCENE_EXTRA = {
    "daily_chat": [
        c("scene_daily_soft_opinions", "A2",
          "Giving a soft opinion in casual chat: 'I kind of like it.', 'I'm not really into sports.', 'It depends, honestly.', 'To be honest, I'd rather stay in.' — soften with 'kind of / not really / honestly' instead of stating opinions like facts.",
          [{"text": "A: How do you like the new office? B: It's nice, though kind of far for me.", "note": "soft opinion"}, {"text": "I'm not really into cooking, but I love eating out.", "note": "not really + into"}],
          [{"error": "I don't like it. (blunt)", "fix": "I'm not really into it.", "explanation": "'Not really into' is the softer, natural everyday version."}],
          ["daily", "opinion", "softening", "small-talk"]),
        c("scene_daily_ending_talk", "A2",
          "Winding down a chat naturally: 'It was great talking to you!', 'I've got to run — let's catch up soon.', 'Anyway, I should get going.', 'Let's talk again later!'. Always pair leaving with a warm closer so it doesn't feel abrupt.",
          [{"text": "Anyway, I should get going — it was great talking to you!", "note": "soft exit"}, {"text": "I've got to run to a meeting. Let's catch up this weekend?", "note": "exit + plan"}],
          [{"error": "I go now, bye. (translation)", "fix": "I've got to get going. Talk to you later!", "explanation": "English pairs leaving with a natural closer phrase."}],
          ["daily", "ending", "goodbye", "small-talk"]),
        c("scene_daily_showing_interest", "A2",
          "Show interest while the other talks: 'Oh, that sounds fun!', 'Really? Tell me more.', 'Wow, how did that happen?', 'That's interesting — what made you try it?'. Asking one follow-up question keeps the friend-like rhythm.",
          [{"text": "A: I started learning guitar. B: That's awesome! How's it going so far?", "note": "interest + follow-up"}, {"text": "No way! Tell me more about the trip.", "note": "enthusiastic nudge"}],
          [{"error": "(Listening silently, no response)", "fix": "React: 'That's cool!' / 'Oh really? How come?'", "explanation": "Active reactions are the glue of casual English chat."}],
          ["daily", "interest", "listening", "conversation"]),
    ],
    "shopping": [
        c("scene_shopping_size_color", "A2",
          "Talking sizes and colors: 'Do you have this in a medium?', 'It comes in three colors — black, white, and gray.', 'This one runs small, so maybe try a size up.', 'What size do you take?'. Ask before guessing: 'What size are you looking for?'.",
          [{"text": "Do you have this jacket in a large?", "note": "size question"}, {"text": "This sweater runs small — you might need a bigger size.", "note": "staff tip"}],
          [{"error": "I want bigger size.", "fix": "Do you have a bigger size? / Could I try a size up?", "explanation": "Ask with a polite question; 'size' needs an article ('a bigger size')."}],
          ["shopping", "size", "color", "clothes"]),
        c("scene_shopping_discount", "A2",
          "Asking about discounts: 'Is this on sale?', 'Do you have any promotions right now?', 'Can you do a better price?', 'It's 30% off this week.', 'The discount ends on Sunday.' — note: 'on sale / X% off', not 'discount' as an adjective.",
          [{"text": "Is there any discount if I buy two?", "note": "multi-buy ask"}, {"text": "These are 20% off, but only until Sunday.", "note": "staff answer"}],
          [{"error": "This shirt is discount.", "fix": "This shirt is on sale / 20% off.", "explanation": "'Discount' is a noun; the natural patterns are 'on sale' or 'X% off'."}],
          ["shopping", "discount", "price", "sale"]),
        c("scene_shopping_checkout", "A2",
          "Paying and leaving: 'How much is it in total?', 'Can I pay by card? / by WeChat?', 'Do you take cash?', 'Could I have a receipt, please?', 'Can I get a bag?', 'That's all, thanks. Have a nice day!'.",
          [{"text": "That'll be 159 yuan. Will that be card or cash?", "note": "checkout exchange"}, {"text": "Could I get a receipt, please? — Sure, here you go.", "note": "receipt request"}],
          [{"error": "How many money is this?", "fix": "How much is it? / How much is this in total?", "explanation": "Always 'how much' for money, never 'how many money'."}],
          ["shopping", "checkout", "payment", "receipt"]),
        c("scene_shopping_refund_exchange", "A2",
          "Returns and exchanges: 'I'd like to return this, please.', 'It doesn't fit — can I exchange it for a smaller size?', 'Do you have the receipt?', 'Our return policy is 7 days with the receipt.', 'It's past the return date, sorry.'.",
          [{"text": "I bought this yesterday, but it's too small. Can I exchange it?", "note": "exchange request"}, {"text": "Sorry, without the receipt we can only offer store credit.", "note": "policy answer"}],
          [{"error": "I want to change this clothes.", "fix": "I'd like to exchange this.", "explanation": "For items, say 'exchange'; 'change' is for money or plans."}],
          ["shopping", "refund", "exchange", "return"]),
        c("scene_shopping_staff_offer", "A2",
          "Shop assistant offers: 'Can I help you find anything?', 'We just got this in — it's very popular.', 'Would you like to try it on?', 'It looks great on you!', 'We have a matching pair if you're interested.', 'Anything else I can help with?'.",
          [{"text": "Can I help you find anything? — Yes, I'm looking for a gift.", "note": "assistant opener"}, {"text": "We have this in blue too, if you'd like to see.", "note": "color offer"}],
          [{"error": "You want buy what? (translation)", "fix": "What are you looking for? / Can I help you find anything?", "explanation": "Assistant openers are polite questions, not literal translations."}],
          ["shopping", "assistant", "offer", "service"]),
    ],
}


def main():
    # 读取全局知识库
    with open(GLOBAL_KB, encoding="utf-8") as f:
        global_chunks = [json.loads(line) for line in f if line.strip()]

    for scene_key, topics in SCENE_TOPICS.items():
        topic_set = set(topics)
        picked = [ch for ch in global_chunks if ch["topic"] in topic_set]

        # 场景补充条目
        extras = SCENE_EXTRA.get(scene_key, [])

        # 重写 id（scene_key_NNNN，幂等）并打场景标记
        lines = []
        counter = 0
        for ch in picked + extras:
            counter += 1
            out = {
                "id": f"{scene_key}_{counter:04d}",
                "category": ch.get("category", "06_speaking"),
                "topic": ch["topic"],
                "level": ch["level"],
                "rule": ch["rule"],
                "examples": ch["examples"],
                "common_errors": ch["common_errors"],
                "tags": ch["tags"],
                "scene": scene_key,
            }
            lines.append(out)

        out_dir = os.path.join(SKILLS_DIR, scene_key)
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, "knowledge.jsonl")
        with open(out_path, "w", encoding="utf-8") as f:
            for line in lines:
                f.write(json.dumps(line, ensure_ascii=False) + "\n")

        # 校验 id 唯一
        ids = [l["id"] for l in lines]
        assert len(ids) == len(set(ids)), f"{scene_key}: duplicate ids"
        print(f"{scene_key}: {len(lines)} chunks (extracted {len(picked)} + extra {len(extras)}) -> {out_path}")


if __name__ == "__main__":
    main()
