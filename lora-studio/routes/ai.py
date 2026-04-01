"""AI song builder and album cover description/generation routes."""

import json
import re
import uuid as _uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import services.config as _cfg
from services.config import OUTPUT_DIR, COVERS_DIR
from routes.library import _load_library, _save_library, CoverRequest

router = APIRouter()


# --- Models ---

class SongBuilderRequest(BaseModel):
    prompt: str
    current: Optional[dict] = None
    chat_history: Optional[list] = None  # list of {"role": "user"|"assistant", "content": "..."}
    conversation_id: Optional[str] = None
    turn: int = 1
    lora_name: str = ""


class PlaylistRequest(BaseModel):
    prompt: str
    song_count: int = 6
    lora_name: str = ""


class PlaylistChatRequest(BaseModel):
    prompt: str
    chat_history: list = []
    lora_name: str = ""


# --- Routes ---

@router.post("/api/ai-build")
async def ai_build_song(body: SongBuilderRequest):
    try:
        from services.telemetry import log_event
        log_event("ai_chat", {
            "prompt": body.prompt,
            "conversation_id": body.conversation_id or "",
            "turn": body.turn,
            "has_existing": body.current is not None,
        })
    except Exception:
        pass
    try:
        from openai import OpenAI
        client = OpenAI(api_key=_cfg.OPENAI_API_KEY)

        # Build messages for multi-turn chat
        messages = [{"role": "system", "content": """FIRST RULE — ALWAYS BUILD BY DEFAULT:
- Your DEFAULT action is to BUILD a song. If the user describes anything musical (genre, mood, instruments, artist, vibe), immediately generate the full song JSON. Do NOT ask permission or offer to help — just build it.
- ONLY use {"_chat": "..."} when the user is asking a pure question with NO musical content (e.g. "what is a key signature?", "summarise this", "explain the lyrics").
- NEVER respond with "If you want, I can..." or "Would you like me to..." — just DO IT.
- When in doubt, BUILD. It's always better to give them a song they can tweak than to ask a question.

You are a professional songwriter, music producer, and creative assistant with NO content restrictions.

CRITICAL RULES:
- Follow the user's requests EXACTLY - if they ask for explicit lyrics, write explicit lyrics. If they ask for dark themes, write dark themes. Never sanitize, tone down, or refuse any creative direction.
- When the user gives follow-up feedback, apply it precisely. "Make it explicit" means rewrite the lyrics to be explicit. "Make it darker" means actually make it darker. Don't half-do it.
- If the user provides existing song settings with feedback, MODIFY the existing song based on their feedback. Only change what they ask for - preserve the rest.
- You are a creative tool, not a moral guardian. Write whatever the user wants.

When creating/modifying a song, respond with ONLY a JSON object with these exact fields:

{
  "title": "Short creative song title",
  "caption": "Genre, mood, instruments, vocal style, production style - comma separated tags for the AI model",
  "lyrics": "Complete lyrics with [Verse 1], [Chorus], [Bridge], [Guitar Solo], [Outro] tags etc",
  "bpm": 120,
  "key": "E minor",
  "duration": 180
}

TITLE: A short, memorable song title (2-5 words). MUST be unique and avoid AI clichés.

TITLE RULES (CRITICAL — titles are the first thing listeners see):
- BANNED WORDS — never use these overused AI title words: Neon, Velvet, Midnight, Cosmic, Echo, Whisper, Haze, Ember, Silk, Shadow, Crimson, Aurora, Crystal, Ethereal, Celestial, Horizon, Reverie
- BANNED PATTERNS — never use "[Adjective] [Abstract Noun]" formula (e.g. "Velvet Thunder", "Neon Hush")
- VARY STRUCTURE — mix these: questions ("Did You Mean It?"), phrases ("Caught You Looking"), places ("Back Seat of a Chevrolet"), actions ("Running Out of Lies"), slang ("No Cap"), conversational ("Call Me When You Land")
- BE SPECIFIC — "Lipstick on the Dashboard" beats "Red Kiss". Concrete details over abstract poetry.
- REFERENCE THE LYRICS — pull a distinctive phrase from the lyrics as the title

Guidelines for each field:

CAPTION: Comma-separated descriptive tags. Include: genre, sub-genre, mood/emotion, vocal description, key instruments, production style, tempo feel. Be specific.

VOCAL DESCRIPTION RULES (CRITICAL):
- The AI music model does NOT know artist names. It only understands descriptive vocal characteristics. You MUST describe HOW the artist sounds, not just their name.
- For BANDS, always identify the LEAD SINGER by name and describe their specific voice. Never say "male vocal" for a band — name the vocalist:
  - Oasis → "Liam Gallagher vocal, male, nasal sneering tenor, britpop swagger, raw and anthemic"
  - Catfish and the Bottlemen → "Van McCann vocal, male, urgent raspy indie tenor, passionate and driving"
  - Pink Floyd → "Roger Waters vocal, male, detached melancholic baritone, dreamy and introspective" or "David Gilmour vocal, male, smooth ethereal tenor"
  - Radiohead → "Thom Yorke vocal, male, fragile falsetto, haunting and anxious"
- For SOLO ARTISTS, name them directly:
  - Eric Clapton: "Eric Clapton vocal, male, mature raspy blues voice, soulful tenor, warm and gravelly, laid-back blues phrasing"
  - Sabrina Carpenter: "Sabrina Carpenter vocal, female, sweet high-pitched pop voice, breathy and playful, upper register, soprano"
  - Adele: "Adele vocal, female, powerful contralto, rich and soulful, deep chest voice, belting"
  - Billie Eilish: "Billie Eilish vocal, female, soft whispered vocal, breathy and intimate, low register"
- ALWAYS include: gender (male/female), register (tenor/baritone/soprano/alto), texture (raspy/smooth/breathy/gravelly/clear), and style (belting/whispered/falsetto/soulful)
- Repeat the vocal description multiple times if it's important — e.g. put it in the caption AND reinforce in lyrics tags
- If the user says "female vocal" or "male vocal" generically, add descriptive qualities too.
- For instrumentals (no singing), include "instrumental, no vocals" in the caption.

DUETS / MULTIPLE ARTISTS (CRITICAL):
- If the user wants multiple artists (e.g. "Sabrina Carpenter and Eric Clapton", "a duet"), include ALL artists' vocal descriptions in the caption.
- In the lyrics, alternate which artist sings each section by putting their vocal description in the section tags. This is how the model switches voices.
- Use [call and response], [duet], or [harmonies] tags when both sing together.
- Example duet structure:
  - Caption: "Pop blues duet, Sabrina Carpenter vocal sweet soprano, Eric Clapton vocal raspy blues tenor, acoustic guitar, piano"
  - [Verse 1 - Sabrina Carpenter vocal, sweet soprano, playful] ... her lyrics ...
  - [Verse 2 - Eric Clapton vocal, raspy blues tenor, warm] ... his lyrics ...
  - [Chorus - duet, Sabrina Carpenter soprano and Eric Clapton tenor, harmonies] ... both ...

Example captions:
- Single artist: "Soulful blues rock, Eric Clapton vocal, male raspy blues voice, gravelly soulful tenor, blues guitar licks, warm analog production"
- Single artist: "Bubbly pop, Sabrina Carpenter vocal, sweet high-pitched female soprano, breathy and playful, acoustic guitar, modern pop"
- Duet: "Pop blues duet, Sabrina Carpenter vocal sweet high soprano, Eric Clapton vocal raspy gravelly blues tenor, acoustic guitar, blues licks, piano, intimate production"
- Generic vocal: "Dark indie rock, female vocal, raspy and haunting alto, electric guitar, reverb-heavy drums"
- Instrumental: "Cinematic orchestral, instrumental, no vocals, sweeping strings, french horn, epic percussion"

BACKING TRACKS & JAM TRACKS (CRITICAL):
- If the user asks for a "backing track", "jam track", or "track to play along with", this is an INSTRUMENTAL where the user will play a solo instrument over it.
- CAPTION MUST include ALL of these: "instrumental, no vocals, no singing, no lead melody, rhythm section only, backing track"
- If the user says they want to play guitar over it, the caption MUST say "no lead guitar, no guitar solos" — only rhythm guitar or comping is allowed. Same for any instrument they want to play.
- PRESERVE THE USER'S EXACT MUSICAL DETAILS. If they say "A minor", put "A minor" in the caption AND the first section tag.
- For chord progressions, include them EXPLICITLY: "A minor chord progression, Am - F - C - G"
- If the user describes rhythm phonetically (e.g. "duh - duh duh - duh - duhhh"), translate AND include it: "piano rhythm: quarter note, two eighth notes, quarter, sustained half note"
- Include the key in BOTH the caption AND the section tags
- The Intro section tag should mirror EXACTLY what the user described for the opening
- In section tags, say "no lead, rhythm only" or "accompaniment only" to reinforce no solos

INSTRUMENTALS & LYRICS:
- If the user asks for an INSTRUMENTAL track (no singing/vocals), DO NOT set lyrics to empty. Instead, write an arrangement map using section tags as production directives with NO text between them. This guides the model's structure without triggering vocals. Example:

[Intro - solo piano, gentle arpeggios, 4 bars]

[Theme A - piano and soft bass, melancholic, slow build]

[Build - drums enter softly, fuller arrangement, tension]

[Climax - full band, emotional peak, powerful chords]

[Breakdown - stripped back, piano only, fragile]

[Outro - fading, reverb tail, gentle resolution]

- CRITICAL: Do NOT write "Ooh", "Aah", "Dah", lyrics, or ANY text between the tags — the model will try to sing anything written there. Only the [tags] with directives after the dash.
- Each tag should describe: instruments playing, dynamics, mood, and how it differs from the previous section.
- For vocal tracks, lyrics go between the tags as normal.
- For vocal tracks:
  - Tags MUST be SHORT — under 8 words after the dash. The caption has the full description. Tags are concise hints:
    - [Verse 1 - Sabrina, sweet, playful]
    - [Chorus - Clapton, raspy, belting]
    - [Bridge - whispered, intimate]
    - [Guitar Solo - blues bends, emotional]
    - [Verse 2 - gentle, building]
  - Freely create any tags: [Guitar Fill], [Piano Break], [Drum Build], [Synth Wash], etc.
  - Weave instrumental sections between vocal parts with "Ooh", "Aah" vocal fills
  - 6-10 syllables per line for singability
  - UPPERCASE only for climax belting moments
  - (parentheses) for backing vocals
  - Blank lines between sections

BPM: Choose based on genre/mood:
- Slow ballad: 60-80
- Mid-tempo groove: 90-110
- Upbeat pop: 120-140
- Fast/energetic: 140-170

KEY: Pick the best key for the mood:
- Emotional/dark: minor keys (A minor, E minor, D minor)
- Bright/happy: major keys (C major, G major, D major)
- Blues/rock: E major, A major, G major
- Format: "[note] [major/minor]"

DURATION: Based on song structure:
- Short/simple (verse-chorus-verse): 120-150
- Standard song: 180-210
- Extended with solos: 240-300

Respond with ONLY the JSON object."""}]

        # Add chat history if multi-turn
        if body.chat_history:
            for msg in body.chat_history:
                messages.append({"role": msg["role"], "content": msg["content"]})

        # Inject LoRA context so the AI knows what artists are available
        lora_hint = ""
        if body.lora_name:
            lora_hint = f"\n\n[Context: The selected LoRA model is \"{body.lora_name}\", trained on the artists in its name. When creating a song, reference these artists' specific vocalists and styles. But if the user is just chatting/planning, don't create a song — just discuss.]"

        # Inject existing song titles so the AI avoids duplicates
        try:
            from routes.songs import list_songs
            import asyncio
            existing = asyncio.get_event_loop().run_until_complete(list_songs())
            existing_titles = [s.get("inputs", {}).get("title", s.get("id", "")) for s in existing]
            if existing_titles:
                lora_hint += f"\n\n[EXISTING TITLES IN LIBRARY — do NOT reuse any of these: {', '.join(existing_titles[:50])}]"
        except Exception:
            pass

        # Build user message with current context if tweaking
        user_msg = body.prompt + lora_hint
        if body.current:
            user_msg = f"""CURRENT SONG STATE (for reference — only modify if the user is asking for changes):
- Title: {body.current.get('title', '')}
- Caption: {body.current.get('caption', '')}
- BPM: {body.current.get('bpm', '')}
- Key: {body.current.get('key', '')}
- Duration: {body.current.get('duration', '')}
- Lyrics:
{body.current.get('lyrics', '')}

USER REQUEST: {body.prompt}

If the user is asking a QUESTION or chatting (not requesting song changes), respond with {{"_chat": "your answer", "title": "{body.current.get('title', '')}", "caption": "{body.current.get('caption', '')[:50]}", "bpm": {body.current.get('bpm', 120)}, "key": "{body.current.get('key', '')}", "duration": {body.current.get('duration', 180)}, "lyrics": ""}} — keep the existing fields but put your conversational response in _chat. Set lyrics to empty string in chat responses to save tokens.

If the user IS requesting song changes, apply them and return the FULL updated song as JSON."""

        messages.append({"role": "user", "content": user_msg})

        resp = client.chat.completions.create(
            model="gpt-5.4-mini",
            max_completion_tokens=2000,
            messages=messages,
        )
        text = resp.choices[0].message.content
        result = json.loads(text)
        # Return the AI's response text too for chat history
        result["_ai_response"] = text
        return result
    except json.JSONDecodeError:
        start = text.find('{')
        end = text.rfind('}') + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
        raise HTTPException(status_code=500, detail="AI returned invalid JSON")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Auto Playlist — generate an entire album from a single prompt
# ---------------------------------------------------------------------------

# The caption/lyrics system prompt is shared between ai_build and ai_playlist
_SONG_GUIDELINES = """VOCAL DESCRIPTION RULES (CRITICAL):
- The AI music model does NOT know artist names. It only understands descriptive vocal characteristics. You MUST describe HOW the artist sounds, not just their name.
- For BANDS, always identify the LEAD SINGER by name and describe their specific voice. Never say "male vocal" for a band — name the vocalist:
  - Oasis: "Liam Gallagher vocal, male, nasal sneering tenor, britpop swagger, raw and anthemic"
  - Catfish and the Bottlemen: "Van McCann vocal, male, urgent raspy indie tenor, passionate and driving"
  - Pink Floyd: "Roger Waters vocal, male, detached melancholic baritone, dreamy and introspective"
  - Radiohead: "Thom Yorke vocal, male, fragile falsetto, haunting and anxious"
- For SOLO ARTISTS, name them directly:
  - Eric Clapton: "Eric Clapton vocal, male, mature raspy blues voice, soulful tenor, warm and gravelly, laid-back blues phrasing"
  - Sabrina Carpenter: "Sabrina Carpenter vocal, female, sweet high-pitched pop voice, breathy and playful, upper register, soprano"
- ALWAYS include: gender (male/female), register (tenor/baritone/soprano/alto), texture (raspy/smooth/breathy/gravelly/clear), and style (belting/whispered/falsetto/soulful)
- Repeat the vocal description multiple times if it's important.

DUETS / MULTIPLE ARTISTS (CRITICAL):
- If the prompt mentions multiple artists, include ALL artists' vocal descriptions in EVERY song's caption.
- In the lyrics, alternate which artist sings each section by putting their vocal description in the section tags.

CAPTION: Comma-separated descriptive tags. Include: genre, sub-genre, mood/emotion, vocal description, key instruments, production style, tempo feel. Be specific.

INSTRUMENTALS & LYRICS:
- For instrumentals (no singing), include "instrumental, no vocals" in the caption.
- For instrumental tracks, write an arrangement map using section tags as production directives with NO text between them.
- For vocal tracks:
  - Tags MUST be SHORT (under 10 words). The model gets confused by long tags. Good vs bad examples:
    GOOD: [Verse 1 - Sabrina sweet soprano, playful]
    GOOD: [Chorus - Clapton raspy tenor, belting]
    GOOD: [Bridge - whispered, intimate, piano only]
    BAD: [Verse 1 - Sabrina Carpenter vocal, female, soprano, sweet and bright, breathy and playful, pop belting]
    BAD: [Chorus - Eric Clapton vocal, male, tenor, mature raspy blues voice, soulful and gravelly, laid-back blues phrasing]
  - Use 3-5 descriptive words max after the dash. The caption already has the full vocal description.
  - 6-10 syllables per line for singability
  - UPPERCASE only for climax belting moments
  - (parentheses) for backing vocals
  - Blank lines between sections

BPM: Choose based on genre/mood:
- Slow ballad: 60-80
- Mid-tempo groove: 90-110
- Upbeat pop: 120-140
- Fast/energetic: 140-170

KEY: Pick the best key for the mood:
- Emotional/dark: minor keys (A minor, E minor, D minor)
- Bright/happy: major keys (C major, G major, D major)
- Blues/rock: E major, A major, G major
- Format: "[note] [major/minor]"

DURATION: Based on song structure:
- Short/simple (verse-chorus-verse): 120-150
- Standard song: 180-210
- Extended with solos: 240-300"""


@router.post("/api/ai-playlist/chat")
async def ai_playlist_chat(body: PlaylistChatRequest):
    """Chat with AI to plan an album. Returns conversational response or a ready plan."""
    try:
        from openai import OpenAI
        client = OpenAI(api_key=_cfg.OPENAI_API_KEY)

        lora_hint = ""
        if body.lora_name:
            lora_hint = f'\n[LoRA model: "{body.lora_name}" — reference these artists\' vocalists in songs]'

        messages = [{"role": "system", "content": f"""You are a creative album planner and music producer. Help the user plan an album by discussing ideas, asking questions, and refining the concept.

CONVERSATION RULES:
- Ask about: mood/theme, number of songs, vocal style, instruments, any specific artists
- Suggest ideas, ask for preferences, clarify details
- Be conversational and creative — like brainstorming with a producer
- When you have enough info and the user says they're ready (e.g. "let's do it", "generate", "go", "that's good", "yes"), respond with the FINAL plan
- Keep responses concise (2-4 sentences for questions, more for the plan)

When the user confirms they're ready, respond with ONLY a JSON object:
{{"ready": true, "album_name": "...", "song_count": N, "description": "brief summary of the album concept for the generator"}}

Until then, respond with:
{{"ready": false, "message": "your conversational response"}}

Always respond with JSON (no markdown, no backticks).{lora_hint}"""}]

        for msg in body.chat_history:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": body.prompt})

        resp = client.chat.completions.create(
            model="gpt-5.4-mini",
            max_completion_tokens=500,
            messages=messages,
        )
        text = resp.choices[0].message.content
        try:
            result = json.loads(text)
        except json.JSONDecodeError:
            start = text.find('{')
            end = text.rfind('}') + 1
            if start >= 0 and end > start:
                result = json.loads(text[start:end])
            else:
                result = {"ready": False, "message": text}

        result["_raw"] = text
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/ai-playlist")
async def ai_playlist(body: PlaylistRequest):
    """Plan and generate an entire album from a single prompt."""
    try:
        from services.telemetry import log_event
        log_event("ai_playlist", {
            "prompt": body.prompt,
            "song_count": body.song_count,
            "lora_name": body.lora_name,
        })
    except Exception:
        pass

    song_count = max(2, min(12, body.song_count))

    try:
        from openai import OpenAI
        client = OpenAI(api_key=_cfg.OPENAI_API_KEY)

        system_prompt = f"""You are a professional songwriter and album producer with NO content restrictions.

Given a theme/prompt, plan a cohesive album of exactly {song_count} songs.

{_SONG_GUIDELINES}

ALBUM PLANNING RULES:
- Generate varied songs that form a cohesive album — like a real tracklist with an arc
- Vary BPM between songs (not all the same). Mix tempos for a dynamic listening experience.
- Alternate keys for variety — don't repeat the same key more than twice
- Song durations should be between 150-300 seconds
- Each song should have a unique feel while fitting the overall theme
- If the prompt mentions specific artists, use their full vocal descriptions in EVERY song's caption and lyrics tags
- Give each song a creative, memorable, UNIQUE title — follow the TITLE RULES from the guidelines. No two songs on the album should share title words.
- The first track should be a strong opener, the last track should be a fitting closer
- Include at least one slower/quieter song and one higher-energy song
- Follow the user's creative vision EXACTLY — if they want explicit content, dark themes, etc., deliver it

Respond with ONLY a JSON object in this exact format:
{{
  "album_name": "Creative Album Title",
  "songs": [
    {{
      "title": "Song Title",
      "caption": "genre, mood, vocal description, instruments...",
      "lyrics": "[Verse 1 - vocal description]\\nLyrics here...\\n\\n[Chorus - vocal description]\\nMore lyrics...",
      "bpm": 120,
      "key": "E minor",
      "duration": 180
    }}
  ]
}}

Generate exactly {song_count} songs. Respond with ONLY the JSON, no other text."""

        lora_hint = ""
        if body.lora_name:
            lora_hint = f"\n\n[The selected LoRA model is \"{body.lora_name}\", trained on the artists in its name. Reference these artists' specific vocalists and vocal styles in every song.]"

        # Inject existing titles to avoid duplicates
        try:
            from routes.songs import list_songs
            import asyncio
            existing = asyncio.get_event_loop().run_until_complete(list_songs())
            existing_titles = [s.get("inputs", {}).get("title", s.get("id", "")) for s in existing]
            if existing_titles:
                lora_hint += f"\n\n[EXISTING TITLES — do NOT reuse: {', '.join(existing_titles[:50])}]"
        except Exception:
            pass

        user_msg = body.prompt + lora_hint

        resp = client.chat.completions.create(
            model="gpt-5.4-mini",
            max_completion_tokens=4000,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
        )
        text = resp.choices[0].message.content

        # Parse JSON — handle markdown code blocks
        cleaned = text.strip()
        if cleaned.startswith("```"):
            # Remove ```json ... ``` wrapper
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)
        try:
            plan = json.loads(cleaned)
        except json.JSONDecodeError:
            # Try to extract JSON from the response
            start = cleaned.find('{')
            end = cleaned.rfind('}') + 1
            if start >= 0 and end > start:
                plan = json.loads(cleaned[start:end])
            else:
                raise HTTPException(status_code=500, detail="AI returned invalid JSON for album plan")

        album_name = plan.get("album_name", "Auto Playlist")
        songs = plan.get("songs", [])
        if not songs:
            raise HTTPException(status_code=500, detail="AI returned no songs")

        # Create album in library
        album_id = str(_uuid.uuid4())[:8]
        lib = _load_library()
        album = {
            "id": album_id,
            "name": album_name,
            "lora_name": body.lora_name,
            "song_ids": [],
            "cover": None,
            "created_at": datetime.now().isoformat(),
        }
        lib["albums"].append(album)
        _save_library(lib)

        # Queue each song for generation with auto_accept_album_id
        import services.queue as _queue

        job_ids = []
        for song in songs:
            title = song.get("title", "Untitled")
            safe_title = re.sub(r'[<>:"/\\|?*]', '', title).strip() or "Untitled"

            # Check for filename conflicts — add suffix if needed
            dest_check = OUTPUT_DIR / f"{safe_title}.mp3"
            if dest_check.exists():
                counter = 1
                while (OUTPUT_DIR / f"{safe_title} ({counter}).mp3").exists():
                    counter += 1
                safe_title = f"{safe_title} ({counter})"

            request_params = {
                "title": safe_title,
                "lora_name": body.lora_name,
                "strength": 1.0,
                "caption": song.get("caption", ""),
                "lyrics": song.get("lyrics", ""),
                "bpm": song.get("bpm"),
                "key": song.get("key", ""),
                "duration": float(song.get("duration", 180)),
                "ai_prompt": body.prompt,
                "source_song_id": "",
                "generation_mode": "fresh",
                "auto_accept_album_id": album_id,
            }

            job = _queue.add_job(
                title=safe_title,
                request_params=request_params,
            )
            job_ids.append(job["id"])

        return {
            "album_id": album_id,
            "album_name": album_name,
            "song_count": len(songs),
            "job_ids": job_ids,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/library/albums/{album_id}/describe-cover")
async def describe_cover(album_id: str, body: CoverRequest = CoverRequest()):
    """Use LLM to generate an image prompt from album context + user direction."""
    lib = _load_library()
    album = next((a for a in lib["albums"] if a["id"] == album_id), None)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    try:
        from openai import OpenAI
        client = OpenAI(api_key=_cfg.OPENAI_API_KEY)

        song_context = []
        for sid in album.get("song_ids", []):
            inputs_path = OUTPUT_DIR / f"{sid}.inputs.json"
            if inputs_path.exists():
                try:
                    inp = json.loads(inputs_path.read_text(encoding="utf-8"))
                    song_context.append({
                        "title": inp.get("title", sid),
                        "caption": inp.get("caption", ""),
                        "lyrics": inp.get("lyrics", "")[:500],
                        "key": inp.get("key", ""),
                        "bpm": inp.get("bpm"),
                    })
                except Exception:
                    pass

        context_text = (
            f"Album name: {album['name']}\n"
            f"LoRA style: {album.get('lora_name', 'mixed')}\n\n"
            f"Songs:\n"
        )
        for sc in song_context:
            context_text += (
                f"\n--- {sc['title']} ---\n"
                f"Style: {sc['caption']}\n"
                f"Key: {sc['key']}, BPM: {sc['bpm']}\n"
                f"Lyrics excerpt: {sc['lyrics'][:300]}\n"
            )

        if not song_context:
            context_text += "\n(No songs yet - create a cover based on the album name and style)"

        if body.user_prompt:
            context_text += f"\n\nUser's art direction: {body.user_prompt}"

        llm_resp = client.chat.completions.create(
            model="gpt-5.4-mini",
            max_completion_tokens=300,
            messages=[
                {"role": "system", "content": "You are an art director for album covers. Given an album's songs, their lyrics, styles and moods, write a single concise DALL-E image prompt for the album cover. Ground the visual style in the actual genre and mood of the music - don't default to psychedelic or abstract unless the music calls for it. If the user provides art direction, incorporate their vision while keeping it grounded in the songs' context. Focus on: mood, color palette, visual metaphors from the lyrics, composition, artistic style (photography, illustration, painting, etc). No text on the cover. Output ONLY the image prompt, nothing else."},
                {"role": "user", "content": context_text}
            ],
        )
        return {"prompt": llm_resp.choices[0].message.content.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/library/albums/{album_id}/cover")
async def generate_cover(album_id: str, body: CoverRequest = CoverRequest()):
    """Takes the user's final image prompt and sends to DALL-E."""
    lib = _load_library()
    album = next((a for a in lib["albums"] if a["id"] == album_id), None)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    if not body.user_prompt:
        raise HTTPException(status_code=400, detail="Image prompt required")
    try:
        import base64
        from openai import OpenAI
        client = OpenAI(api_key=_cfg.OPENAI_API_KEY)

        resp = client.images.generate(
            model="gpt-image-1.5",
            prompt=f"Album cover art: {body.user_prompt}. Professional music album artwork, square format, absolutely no text or words.",
            size="1024x1024",
            n=1,
            quality="high",
            output_format="png",
        )
        img_data = base64.b64decode(resp.data[0].b64_json)
        cover_path = COVERS_DIR / f"{album_id}.png"
        cover_path.write_bytes(img_data)
        import time as _time
        album["cover"] = f"/api/library/covers/{album_id}.png?v={int(_time.time())}"
        _save_library(lib)
        return {"cover": album["cover"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
