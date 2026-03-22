import React, { useState, useEffect, useRef, useCallback } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";
import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth";
import { 
  Dice5, 
  User, 
  Heart, 
  Zap, 
  Star, 
  BookOpen, 
  Plus, 
  RotateCcw, 
  Save, 
  Download, 
  Trash2, 
  Send,
  ChevronRight,
  Shield,
  Sword,
  ScrollText,
  Settings,
  Menu,
  X,
  FileText,
  FileUp,
  Cloud
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// --- UTILS ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- CONSTANTS ---
const ATTR_CFG = {
  generic: ["FOR", "AGI", "MEN", "SOC", "RES"],
  dnd5e: ["FOR", "DES", "CON", "INT", "SAB", "CAR"],
  gurps: ["ST", "DX", "IQ", "HT"],
};

const ATTR_LABELS: Record<string, string> = {
  FOR: "Força",
  AGI: "Agilidade",
  MEN: "Mente",
  SOC: "Social",
  RES: "Resistência",
  DES: "Destreza",
  CON: "Constituição",
  INT: "Inteligência",
  SAB: "Sabedoria",
  CAR: "Carisma",
  ST: "Força (ST)",
  DX: "Destreza (DX)",
  IQ: "Inteligência (IQ)",
  HT: "Vitalidade (HT)",
};

function d5mod(v: number) {
  const m = Math.floor((v - 10) / 2);
  return (m >= 0 ? "+" : "") + m;
}

// --- TYPES ---
interface Skill {
  name: string;
  attr: string;
  bonus: number;
}

interface Character {
  name: string;
  arch: string;
  motiv: string;
  weak: string;
  avatarUrl: string;
  hp: number;
  hpMax: number;
  ac: number;
  attrs: Record<string, number>;
  attrs5e: Record<string, number>;
  attrsGurps: Record<string, number>;
  skills: Skill[];
  notes: string;
}

interface Adventure {
  id: string;
  name: string;
  sys: "generic" | "dnd5e" | "gurps";
  char: Character;
  history: { role: "user" | "model"; parts: { text: string }[] }[];
  log: LogEntry[];
  createdAt: string;
  updatedAt: string;
}

interface LogEntry {
  id: string;
  type: "dm" | "pl" | "roll" | "sys";
  content: any;
}

// --- INITIALIZERS ---
function blankChar(): Character {
  return {
    name: "",
    arch: "",
    motiv: "",
    weak: "",
    avatarUrl: "",
    hp: 10,
    hpMax: 10,
    ac: 10,
    attrs: { FOR: 2, AGI: 2, MEN: 2, SOC: 2, RES: 2 },
    attrs5e: { FOR: 10, DES: 10, CON: 10, INT: 10, SAB: 10, CAR: 10 },
    attrsGurps: { ST: 10, DX: 10, IQ: 10, HT: 10 },
    skills: [],
    notes: "",
  };
}

function blankAdv(name = "Nova Aventura"): Adventure {
  return {
    id: Date.now().toString(),
    name,
    sys: "generic",
    char: blankChar(),
    history: [],
    log: [],
    createdAt: new Date().toLocaleDateString("pt-BR"),
    updatedAt: new Date().toLocaleDateString("pt-BR"),
  };
}

function arcEmoji(a = "") {
  a = a.toLowerCase();
  if (/detet|invest/.test(a)) return "🔍";
  if (/ladr|ladino/.test(a)) return "🗝️";
  if (/hack|tech|ti/.test(a)) return "💻";
  if (/mago|feitiç/.test(a)) return "🧙";
  if (/guerr|barb|fighter/.test(a)) return "⚔️";
  if (/clér|padre/.test(a)) return "✝️";
  if (/espião|spy/.test(a)) return "🕵️";
  if (/méd|doctor/.test(a)) return "⚕️";
  if (/jornali/.test(a)) return "📰";
  if (/bardo/.test(a)) return "🎵";
  if (/palad/.test(a)) return "🛡️";
  if (/ranger|patrulh/.test(a)) return "🏹";
  return "🧍";
}

function computeAttrBonus(skills: Skill[], k: string) {
  return skills.reduce((s, sk) => (sk.attr?.toUpperCase() === k ? s + (Number(sk.bonus) || 0) : s), 0);
}

// --- APP COMPONENT ---
export default function App() {
  const [adventures, setAdventures] = useState<Record<string, Adventure>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [sys, setSys] = useState<"generic" | "dnd5e" | "gurps">("generic");
  const [char, setChar] = useState<Character>(blankChar());
  const [history, setHistory] = useState<{ role: "user" | "model"; parts: { text: string }[] }[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [bonus, setBonus] = useState(0);
  const [diceCount, setDiceCount] = useState(1);
  const [modal, setModal] = useState<"new" | "load" | "upload" | "file-context" | null>(null);
  const [newAdvName, setNewAdvName] = useState("");
  const [editingId, setEditingId] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingType, setPendingType] = useState<"json" | "context" | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  const logRef = useRef<HTMLDivElement>(null);
  const msgId = useRef(0);

  const nextId = () => (++msgId.current).toString();

  // --- PERSISTENCE ---
  const saveAll = (advs: Record<string, Adventure>) => {
    setAdventures(advs);
    try {
      localStorage.setItem("rpg_advs", JSON.stringify(advs));
    } catch (e) {}
  };

  const loadAll = (): Record<string, Adventure> => {
    try {
      return JSON.parse(localStorage.getItem("rpg_advs") || "{}");
    } catch (e) {
      return {};
    }
  };

  const flash = (msg = "✦ Salvo") => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  // --- INITIALIZATION ---
  useEffect(() => {
    const advs = loadAll();
    const lastId = localStorage.getItem("rpg_last");
    if (lastId && advs[lastId]) {
      setAdventures(advs);
      activateAdv(advs[lastId], advs, false);
    } else {
      const adv = blankAdv("Primeira Aventura");
      advs[adv.id] = adv;
      saveAll(advs);
      setCurrentId(adv.id);
      localStorage.setItem("rpg_last", adv.id);
      setAdventures(advs);
      setSys("generic");
      setChar(blankChar());
      setHistory([]);
      setLog([]);
      appendLog("sys", "Aventura criada · Sistema Genérico");
      appendLog("dm", "Saudações, aventureiro.\n\nSou o Mestre — o guardião das histórias e juiz do destino. Antes de começarmos nossa jornada, preciso conhecer quem você é.\n\n**Por favor, preencha sua ficha de personagem à esquerda e me conte um pouco sobre sua história (backstory).** O que te motiva? Qual sua maior fraqueza? Quando estiver pronto, me apresente seu personagem e diga onde sua jornada começa.");
    }
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const appendLog = (type: LogEntry["type"], content: any) => {
    setLog((prev) => [...prev, { id: nextId(), type, content }]);
  };

  const saveCurrentState = useCallback(
    (advs: Record<string, Adventure>, id: string | null, curSys: "generic" | "dnd5e" | "gurps", curChar: Character, curHist: any[], curLog: LogEntry[]) => {
      if (!id || !advs[id]) return advs;
      const updated = {
        ...advs,
        [id]: {
          ...advs[id],
          sys: curSys,
          char: curChar,
          history: curHist,
          log: curLog,
          updatedAt: new Date().toLocaleDateString("pt-BR"),
        },
      };
      saveAll(updated);
      return updated;
    },
    []
  );

  const doAutoSave = (overrideLog?: LogEntry[]) => {
    setAdventures((prev) => {
      const updated = saveCurrentState(prev, currentId, sys, char, history, overrideLog || log);
      return updated;
    });
  };

  const activateAdv = (adv: Adventure, advs: Record<string, Adventure>, isNew: boolean) => {
    setCurrentId(adv.id);
    localStorage.setItem("rpg_last", adv.id);
    setSys(adv.sys || "generic");
    setChar({ ...blankChar(), ...(adv.char || {}) });
    setHistory(adv.history || []);
    if (!isNew && adv.log?.length) {
      setLog(adv.log);
    } else {
      const welcome: LogEntry[] = [
        { id: nextId(), type: "sys", content: `"${adv.name}" carregada` },
        { id: nextId(), type: "dm", content: `**${adv.name}** — aventura carregada.\n\nO Mestre aguarda sua ação.` },
      ];
      setLog(isNew ? welcome : adv.log || welcome);
    }
  };

  const confirmNew = () => {
    const name = newAdvName.trim() || "Nova Aventura";
    setAdventures((prev) => {
      const saved = saveCurrentState(prev, currentId, sys, char, history, log);
      const adv = blankAdv(name);
      const next = { ...saved, [adv.id]: adv };
      saveAll(next);
      setTimeout(() => {
        activateAdv(adv, next, true);
      }, 0);
      return next;
    });
    setModal(null);
    flash(`"${name}" iniciada!`);
  };

  const selectAdv = (id: string) => {
    setAdventures((prev) => {
      const saved = saveCurrentState(prev, currentId, sys, char, history, log);
      const adv = saved[id];
      if (adv) setTimeout(() => activateAdv(adv, saved, false), 0);
      return saved;
    });
    setModal(null);
  };

  const deleteAdv = (id: string) => {
    setAdventures((prev) => {
      const next = { ...prev };
      delete next[id];
      saveAll(next);
      if (id === currentId) {
        const remaining = Object.keys(next);
        if (remaining.length) setTimeout(() => selectAdv(remaining[0]), 0);
      }
      return next;
    });
    setDeletingId(null);
    flash("Aventura excluída");
  };

  // --- AI LOGIC ---
  const updateCharacterSheetTool = {
    name: "updateCharacterSheet",
    description: "Atualiza as informações da ficha do personagem (nome, arquétipo, motivação, fraqueza, HP, CA, atributos, habilidades).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Novo nome do personagem" },
        arch: { type: Type.STRING, description: "Novo arquétipo ou classe" },
        motiv: { type: Type.STRING, description: "Nova motivação" },
        weak: { type: Type.STRING, description: "Nova fraqueza" },
        hp: { type: Type.NUMBER, description: "Novo valor de HP atual" },
        hpMax: { type: Type.NUMBER, description: "Novo valor de HP máximo" },
        ac: { type: Type.NUMBER, description: "Novo valor de CA (Classe de Armadura)" },
        attrs: { 
          type: Type.OBJECT, 
          description: "Novos valores de atributos (depende do sistema)",
          properties: {
            FOR: { type: Type.NUMBER }, AGI: { type: Type.NUMBER }, MEN: { type: Type.NUMBER }, SOC: { type: Type.NUMBER }, RES: { type: Type.NUMBER },
            DES: { type: Type.NUMBER }, CON: { type: Type.NUMBER }, INT: { type: Type.NUMBER }, SAB: { type: Type.NUMBER }, CAR: { type: Type.NUMBER },
            ST: { type: Type.NUMBER }, DX: { type: Type.NUMBER }, IQ: { type: Type.NUMBER }, HT: { type: Type.NUMBER }
          }
        },
        skills: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              attr: { type: Type.STRING },
              bonus: { type: Type.NUMBER }
            }
          }
        }
      }
    }
  };

  const updateInventoryTool = {
    name: "updateInventory",
    description: "Adiciona ou remove itens do inventário/notas do personagem.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        notes: { type: Type.STRING, description: "O novo conteúdo completo das notas/inventário." }
      },
      required: ["notes"]
    }
  };

  const buildSystemPrompt = () => {
    let ak = "attrs";
    if (sys === "dnd5e") ak = "attrs5e";
    if (sys === "gurps") ak = "attrsGurps";

    const attrStr = Object.entries((char as any)[ak] || {})
      .map(([k, v]) => {
        const bonusVal = computeAttrBonus(char.skills, k);
        const mod = sys === "dnd5e" ? ` (${d5mod(v as number)})` : "";
        const bStr = bonusVal ? ` [+${bonusVal} hab]` : "";
        return `${k}:${v}${mod}${bStr}`;
      })
      .join(" | ");
    const skillStr = char.skills.map((sk) => `${sk.name}${sk.attr ? ` [${sk.attr}]` : ""} +${sk.bonus || 0}`).join(", ") || "nenhuma";
    
    let mechanics = "";
    let tone = "";
    if (sys === "generic") {
      mechanics = "Mecânica: 1d20 + atributo vs CD. CD: 8=fácil, 12=médio, 16=difícil, 20=muito difícil. Nat.20=crítico. Nat.1=falha dramática.";
      tone = "Tom: Equilibrado, adaptável ao cenário.";
    } else if (sys === "dnd5e") {
      mechanics = "Mecânica D&D 5e: 1d20 + modificador vs CD/CA. Nat.20=crítico. Nat.1=falha. Salvaguardas. CA (Classe de Armadura) é usada para ataques.";
      tone = "Tom: ÉPICO, HERÓICO, ALTA FANTASIA. Use descrições grandiosas de magias e combates. O destino do mundo está em jogo.";
    } else if (sys === "gurps") {
      mechanics = "Mecânica GURPS: 3d6. O sucesso ocorre se o resultado for MENOR ou IGUAL ao atributo/perícia modificado. 3 ou 4 é sucesso crítico. 17 ou 18 é falha crítica.";
      tone = "Tom: REALISTA, DETALHADO, TÁTICO. Descreva as consequências físicas das ações, o peso do equipamento e a precisão técnica.";
    }

    return `Você é um Mestre de RPG experiente, criativo e imersivo. Narre em português brasileiro.

SISTEMA: ${sys === "dnd5e" ? "D&D 5e" : sys === "gurps" ? "GURPS" : "Sistema Genérico"}
${mechanics}
${tone}

PERSONAGEM:
Nome: ${char.name || "não definido"} | Arquétipo: ${char.arch || "—"}
Motivação: ${char.motiv || "desconhecida"} | Fraqueza: ${char.weak || "desconhecida"}
HP: ${char.hp}/${char.hpMax || "?"} | CA: ${char.ac || "10"}
Atributos: ${attrStr}
Habilidades: ${skillStr}
Notas: ${char.notes || "—"}

DIRETRIZES DE STORYTELLING:
- Narre de forma atmosférica, imersiva e cinematográfica.
- Use o tom especificado acima para o sistema escolhido.
- Descreva ações e consequências com riqueza de detalhes sensoriais (cheiros, sons, sensações táteis).
- Use Markdown para formatação:
  - **Negrito** para ênfase dramática ou nomes importantes.
  - *Itálico* para pensamentos, sussurros ou descrições puramente sensoriais.
  - > Citações para falas de NPCs ou pergaminhos.
- Quando ação incerta: peça rolagem com "🎲 Role [QUANTIDADE]d[LADOS] + [BÔNUS]! CD [N]".
- Simule dados de NPCs abertamente: "🎲 [NPC rola X + Y = Z]".
- Falhas complicam, nunca travam a história.
- Recompense bom roleplay com bônus narrativo.
- Se o usuário importar um arquivo de contexto, analise-o, atualize a ficha (se necessário) e retome a narrativa de forma fluida, contextualizando o que foi lido e pedindo para prosseguir.
- Sugira atualizações de ficha ao longo da aventura.
- Termine sempre com escolha ou pergunta para o jogador.
- Respostas 100-250 palavras.
- Ao oferecer opções de ação, SEMPRE sugira os dados e o bônus correto baseado na ficha do personagem (ex: "[Persuadir] ... (role 1d20 + 2)").
- IMPORTANTE: NUNCA escreva o código das ferramentas (como updateCharacterSheet) no texto da sua resposta. Use as ferramentas silenciosamente e responda apenas com a narrativa.`;
  };

  const processAIResponse = async (newHist: any[]) => {
    setLoading(true);
    try {
      const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      const model = genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: newHist,
        config: {
          systemInstruction: buildSystemPrompt(),
          tools: [{ functionDeclarations: [updateCharacterSheetTool, updateInventoryTool] }]
        },
      });

      const response = await model;

      // Handle function calls
      if (response.functionCalls) {
        for (const call of response.functionCalls) {
          if (call.name === "updateCharacterSheet") {
            const args = call.args as any;
            updateChar(c => {
              if (args.name) c.name = args.name;
              if (args.arch) c.arch = args.arch;
              if (args.motiv) c.motiv = args.motiv;
              if (args.weak) c.weak = args.weak;
              if (args.hp !== undefined) c.hp = args.hp;
              if (args.hpMax !== undefined) c.hpMax = args.hpMax;
              if (args.ac !== undefined) c.ac = args.ac;
              if (args.attrs) {
                const map = getAttrMap();
                (c as any)[map] = { ...(c as any)[map], ...args.attrs };
              }
              if (args.skills) c.skills = args.skills;
            });
            flash("Ficha atualizada pelo Mestre!");
          } else if (call.name === "updateInventory") {
            const args = call.args as any;
            updateChar(c => { c.notes = args.notes || ""; });
            flash("Inventário atualizado!");
          }
        }
      }

      const rawReply = response.text || "O Mestre observa suas ações...";
      // Clean up potential tool call hallucinations from text
      const reply = rawReply.replace(/tool_code:default_api:\w+\{.*?\}/gs, "").trim() || "O Mestre observa suas ações...";
      
      const updHist = [...newHist, { role: "model" as const, parts: [{ text: reply }] }];
      setHistory(updHist);
      appendLog("dm", reply);
    } catch (e) {
      console.error(e);
      appendLog("dm", "_O Mestre hesita por um momento... tente novamente._");
    } finally {
      setLoading(false);
    }
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const txt = input.trim();
    setInput("");
    appendLog("pl", txt);
    const newHistItem = { role: "user" as const, parts: [{ text: txt }] };
    const newHist = [...history, newHistItem];
    setHistory(newHist);
    await processAIResponse(newHist);
  };

  const roll = (sides: number) => {
    if (loading) return;
    const count = Number(diceCount) || 1;
    const b = Number(bonus) || 0;
    const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
    const nat = rolls.reduce((a, b) => a + b, 0);
    const total = nat + b;
    let badge = "",
      type = "";
    
    if (sys === "gurps" && count === 3 && sides === 6) {
      if (nat <= 4) { type = "crit"; badge = "✨ SUCESSO CRÍTICO"; }
      else if (nat >= 17) { type = "fail"; badge = "💀 FALHA CRÍTICA"; }
      else if (nat <= 10) { type = "success"; badge = "✓ Sucesso"; }
      else { type = "fail"; badge = "✗ Fracasso"; }
    } else if (sides === 20 && count === 1) {
      if (nat === 20) { type = "crit"; badge = "✨ CRÍTICO"; }
      else if (nat === 1) { type = "fail"; badge = "💀 FALHA"; }
      else if (total >= 16) { type = "success"; badge = "✓ Sucesso"; }
      else if (total <= 8) { type = "fail"; badge = "✗ Fracasso"; }
    } else {
      // Generic success/fail thresholds
      if (sides === 20) {
        if (nat === 20) { type = "crit"; badge = "✨ CRÍTICO"; }
        else if (nat === 1) { type = "fail"; badge = "💀 FALHA"; }
        else if (total >= 15) { type = "success"; badge = "✓ Sucesso"; }
      } else if (sides === 100) {
        if (total <= 10) { type = "crit"; badge = "✨ CRÍTICO"; }
        else if (total >= 90) { type = "fail"; badge = "💀 FALHA"; }
      }
    }
    
    const rollContent = { nat, total, sides, count, rolls, bonus: b, badge, type };
    appendLog("roll", rollContent);
    
    const bonusStr = b !== 0 ? `${b > 0 ? " + " : " - "}${Math.abs(b)}` : "";
    const rollTxt = `[Rolei ${count}d${sides}${bonusStr} → (${rolls.join(" + ")})${bonusStr} = ${total}${
      badge ? ` — ${badge}` : ""
    }]`;
    
    // Combine with input if present
    const userText = input.trim();
    const finalTxt = userText ? `${userText}\n\n${rollTxt}` : rollTxt;
    
    if (userText) {
      setInput("");
      appendLog("pl", userText);
    }

    const newHistItem = { role: "user" as const, parts: [{ text: finalTxt }] };
    const newHist = [...history, newHistItem];
    setHistory(newHist);
    processAIResponse(newHist);
  };

  // --- CHAR HELPERS ---
  const updateChar = (fn: (c: Character) => void) => {
    setChar((prev) => {
      const c = { ...prev };
      fn(c);
      return c;
    });
  };

  const getAttrMap = () => {
    if (sys === "dnd5e") return "attrs5e";
    if (sys === "gurps") return "attrsGurps";
    return "attrs";
  };
  const getAttrVal = (k: string) => (char[getAttrMap()] || {})[k] || 0;
  const setAttrVal = (k: string, v: number) => {
    updateChar((c) => {
      const map = getAttrMap();
      (c as any)[map] = { ...(c as any)[map], [k]: v };
    });
  };

  const applyHP = (dir: number) => {
    if (!char.hpMax) {
      flash("Defina o HP máximo primeiro");
      return;
    }
    const amt = Number((document.getElementById("hpAmt") as HTMLInputElement)?.value) || 1;
    updateChar((c) => {
      c.hp = Math.max(0, Math.min(c.hpMax, c.hp + dir * amt));
    });
    appendLog("roll", { nat: null, badge: dir < 0 ? `⚔ −${amt} dano` : `💚 +${amt} curado`, type: dir < 0 ? "fail" : "" });
  };

  const handleConfirmUpload = async () => {
    if (!pendingFile || !pendingType) return;
    
    setLoading(true);
    flash("Lendo arquivo...");
    try {
      if (pendingType === "json") {
        const text = await pendingFile.text();
        const imported = JSON.parse(text);
        if (imported.id && imported.char) {
          setAdventures(prev => {
            const next = { ...prev, [imported.id]: imported };
            saveAll(next);
            setTimeout(() => activateAdv(imported, next, false), 0);
            return next;
          });
          setModal(null);
          setPendingFile(null);
          setPendingType(null);
          flash("Aventura restaurada!");
        } else {
          flash("Arquivo JSON inválido.");
        }
      } else {
        // Context Import
        let text = "";
        try {
          if (pendingFile.type === "application/pdf") {
            const arrayBuffer = await pendingFile.arrayBuffer();
            // Use global pdfjsLib if available, or the imported one
            const lib = (window as any).pdfjsLib || pdfjsLib;
            const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
            let fullText = "";
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const content = await page.getTextContent();
              const strings = content.items.map((item: any) => item.str);
              fullText += strings.join(" ") + "\n";
            }
            text = fullText;
          } else if (pendingFile.name.endsWith(".docx")) {
            const arrayBuffer = await pendingFile.arrayBuffer();
            // Use global mammoth if available, or the imported one
            const m = (window as any).mammoth || mammoth;
            const result = await m.extractRawText({ arrayBuffer });
            text = result.value;
          } else {
            text = await pendingFile.text();
          }
        } catch (readErr) {
          console.error("Error reading file:", readErr);
          flash("Erro ao ler o arquivo. Tente um formato diferente.");
          setLoading(false);
          return;
        }

        if (!text.trim()) {
          flash("O arquivo parece estar vazio.");
          setLoading(false);
          return;
        }

        // Close modal immediately after reading
        setModal(null);
        const currentFileName = pendingFile.name;
        setPendingFile(null);
        setPendingType(null);

        appendLog("sys", `Arquivo "${currentFileName}" lido pelo Mestre.`);
        appendLog("pl", `Importando contexto de "${currentFileName}"...`);
        
        const contextMsg = `[CONTEXTO IMPORTADO DO ARQUIVO "${currentFileName}"]: \n\n${text}\n\n[FIM DO CONTEXTO]. Por favor, analise as informações acima, atualize minha ficha se necessário e continue a aventura de onde parou.`;
        
        const newHistItem = { role: "user" as const, parts: [{ text: contextMsg }] };
        const newHist = [...history, newHistItem];
        setHistory(newHist);

        const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
        const model = genAI.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: newHist,
          config: {
            systemInstruction: buildSystemPrompt(),
            tools: [{ functionDeclarations: [updateCharacterSheetTool, updateInventoryTool] }]
          },
        });

        const response = await model;

        if (response.functionCalls) {
          for (const call of response.functionCalls) {
            if (call.name === "updateCharacterSheet") {
              const args = call.args as any;
              updateChar(c => {
                if (args.name) c.name = args.name;
                if (args.arch) c.arch = args.arch;
                if (args.motiv) c.motiv = args.motiv;
                if (args.weak) c.weak = args.weak;
                if (args.hp !== undefined) c.hp = args.hp;
                if (args.hpMax !== undefined) c.hpMax = args.hpMax;
                if (args.ac !== undefined) c.ac = args.ac;
                if (args.attrs) {
                  const map = getAttrMap();
                  (c as any)[map] = { ...(c as any)[map], ...args.attrs };
                }
                if (args.skills) c.skills = args.skills;
              });
              flash("Ficha atualizada pelo Mestre!");
            } else if (call.name === "updateInventory") {
              const args = call.args as any;
              updateChar(c => { c.notes = args.notes || ""; });
              flash("Inventário atualizado!");
            }
          }
        }

        const rawReply = response.text || "O Mestre processou as informações do arquivo.";
        // Clean up potential tool call hallucinations from text
        const reply = rawReply.replace(/tool_code:default_api:\w+\{.*?\}/gs, "").trim() || "O Mestre processou as informações do arquivo.";

        setHistory(h => [...h, { role: "model" as const, parts: [{ text: reply }] }]);
        appendLog("dm", reply);
      }
    } catch (err) {
      console.error(err);
      flash("Erro ao processar arquivo.");
    } finally {
      setLoading(false);
    }
  };

  // --- DOWNLOAD ---
  const downloadLog = () => {
    const advName = adventures[currentId || ""]?.name || "aventura";
    let txt = `RPG•DM — LOG DE AVENTURA\n${advName}\nPersonagem: ${char.name} (${char.arch})\n${new Date().toLocaleDateString("pt-BR")}\n${"═".repeat(40)}\n\n`;
    log.forEach((m) => {
      if (m.type === "dm") txt += `[MESTRE]\n${String(m.content).trim()}\n\n`;
      else if (m.type === "pl") txt += `[JOGADOR]\n${m.content}\n\n`;
      else if (m.type === "roll" && typeof m.content === "object")
        txt += `[DADO] d${m.content.sides}: ${m.content.nat}${m.content.bonus ? ` +${m.content.bonus}=${m.content.total}` : ""} ${m.content.badge}\n\n`;
      else if (m.type === "sys") txt += `— ${m.content} —\n\n`;
    });
    const a = document.createElement("a");
    a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(txt);
    a.download = `log_${advName.replace(/\s+/g, "_")}.txt`;
    a.click();
  };

  const downloadSheet = () => {
    const ak = getAttrMap();
    let txt = `RPG•DM — FICHA DE PERSONAGEM\n${"═".repeat(40)}\n\n`;
    txt += `Nome: ${char.name || "—"}\nArquétipo: ${char.arch || "—"}\nMotivação: ${char.motiv || "—"}\nFraqueza: ${char.weak || "—"}\n\nHP: ${char.hp} / ${char.hpMax || "—"}\n\nATRIBUTOS\n`;
    Object.entries(char[ak]).forEach(([k, v]) => {
      const bonus = computeAttrBonus(char.skills, k);
      txt += `${k}: ${v}${sys === "dnd5e" ? ` (${d5mod(v)})` : ""}${bonus ? ` [+${bonus} hab]` : ""}\n`;
    });
    txt += `\nHABILIDADES\n`;
    char.skills.forEach((sk) => {
      txt += `✦ ${sk.name}${sk.attr ? ` [${sk.attr}]` : ""} +${sk.bonus || 0}\n`;
    });
    if (char.notes) txt += `\nNOTAS\n${char.notes}\n`;
    txt += `\nSistema: ${sys === "dnd5e" ? "D&D 5e" : "Genérico"} | ${new Date().toLocaleDateString("pt-BR")}`;
    const a = document.createElement("a");
    a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(txt);
    a.download = `ficha_${char.name || "personagem"}.txt`;
    a.click();
  };

  // --- RENDER HELPERS ---
  const renderMsg = (m: LogEntry) => {
    if (m.type === "dm") {
      return (
        <motion.div
          key={m.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-2 max-w-[90%] self-start"
        >
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-amber-500/60 font-mono">
            <ScrollText size={12} />
            Mestre
          </div>
          <div className="bg-zinc-900/50 border-l-2 border-amber-600/40 p-5 rounded-r-lg text-zinc-100 leading-relaxed text-sm max-w-none">
            <ReactMarkdown 
              components={{
                p: ({children}) => <p className="mb-4 last:mb-0">{children}</p>,
                strong: ({children}) => <strong className="text-amber-400 font-bold">{children}</strong>,
                em: ({children}) => <em className="text-zinc-400 italic">{children}</em>,
                blockquote: ({children}) => <blockquote className="border-l-2 border-zinc-700 pl-4 italic text-zinc-500 my-4">{children}</blockquote>,
                ul: ({children}) => <ul className="list-disc list-inside mb-4 space-y-1">{children}</ul>,
                ol: ({children}) => <ol className="list-decimal list-inside mb-4 space-y-1">{children}</ol>,
                li: ({children}) => <li className="text-zinc-300">{children}</li>
              }}
            >
              {String(m.content)}
            </ReactMarkdown>
          </div>
        </motion.div>
      );
    }
    if (m.type === "pl") {
      return (
        <motion.div
          key={m.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-2 max-w-[80%] self-end"
        >
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-emerald-500/60 font-mono self-end">
            Aventureiro
            <User size={12} />
          </div>
          <div className="bg-emerald-950/20 border-r-2 border-emerald-600/40 p-3 rounded-l-lg text-emerald-50 text-sm italic text-right">
            {m.content}
          </div>
        </motion.div>
      );
    }
    if (m.type === "roll") {
      const r = m.content;
      if (typeof r === "string") {
        return (
          <div key={m.id} className="self-center py-2 px-4 bg-zinc-900/80 border border-zinc-800 rounded-full text-xs font-mono text-zinc-400">
            {r}
          </div>
        );
      }
      const isCrit = r.type === "crit";
      const isFail = r.type === "fail";
      const isSuccess = r.type === "success";
      const bonusStr = r.bonus !== 0 ? `${r.bonus > 0 ? " + " : " - "}${Math.abs(r.bonus)}` : "";

      return (
        <motion.div
          key={m.id}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="self-center flex flex-col items-center gap-2 py-3 px-6 bg-zinc-900 border border-amber-900/30 rounded-lg shadow-xl"
        >
          <div className="flex items-center gap-3">
            <Dice5 size={16} className="text-amber-500" />
            <span className="text-xs font-mono text-zinc-500 uppercase tracking-tighter">{r.count}d{r.sides}{bonusStr}</span>
            <span className={cn(
              "text-2xl font-bold font-serif",
              isCrit ? "text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" : 
              isFail ? "text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]" : 
              isSuccess ? "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" :
              "text-amber-200"
            )}>
              {r.total}
            </span>
            {r.badge && (
              <span className={cn(
                "text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest",
                isCrit ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
                isFail ? "bg-red-500/20 text-red-400 border border-red-500/30" :
                "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              )}>
                {r.badge}
              </span>
            )}
          </div>
          {(r.count > 1 || r.bonus !== 0) && (
            <div className="text-[10px] font-mono text-zinc-500 italic">
              ({r.rolls.join(" + ")})${bonusStr} = {r.total}
            </div>
          )}
        </motion.div>
      );
    }
    if (m.type === "sys") {
      return (
        <div key={m.id} className="self-center text-[9px] uppercase tracking-[0.3em] text-zinc-600 font-mono py-4">
          — {m.content} —
        </div>
      );
    }
    return null;
  };

  const advList = Object.values(adventures).sort((a, b) => Number(b.id) - Number(a.id));
  const currentAdvName = adventures[currentId || ""]?.name || "Sem aventura";

  return (
    <div className="flex flex-col h-screen bg-black text-zinc-300 font-sans selection:bg-amber-500/30">
      {/* --- HEADER --- */}
      <header className="h-14 border-b border-zinc-800 bg-zinc-950 flex items-center justify-between px-4 z-30 shrink-0">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 lg:hidden"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-600 rounded flex items-center justify-center shadow-[0_0_15px_rgba(217,119,6,0.3)]">
              <Dice5 size={20} className="text-white" />
            </div>
            <h1 className="text-lg font-serif font-bold tracking-tighter text-amber-100 hidden sm:block">
              Mesa Digital
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setModal("upload")}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold uppercase tracking-widest text-zinc-400 transition-all"
          >
            <Download size={14} className="rotate-180" />
            Subir
          </button>
          <button 
            onClick={() => { setNewAdvName(""); setModal("new"); }}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold uppercase tracking-widest text-zinc-400 transition-all"
          >
            <Plus size={14} />
            Nova
          </button>
          <button 
            onClick={() => setModal("load")}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold uppercase tracking-widest text-zinc-400 transition-all"
          >
            <RotateCcw size={14} />
            Carregar
          </button>
          <button 
            onClick={() => { doAutoSave(); flash("Aventura salva!"); }}
            className="flex items-center gap-2 px-3 py-1.5 bg-amber-600/10 hover:bg-amber-600/20 border border-amber-600/30 rounded text-[10px] font-bold uppercase tracking-widest text-amber-500 transition-all"
          >
            <Save size={14} />
            Salvar
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-zinc-900/50 border border-zinc-800 rounded text-[10px] font-mono text-zinc-500">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            {currentAdvName}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={downloadSheet} className="p-2 hover:bg-zinc-800 rounded text-zinc-500" title="Baixar Ficha"><User size={18} /></button>
            <button onClick={downloadLog} className="p-2 hover:bg-zinc-800 rounded text-zinc-500" title="Baixar Log"><Download size={18} /></button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* --- SIDEBAR --- */}
        <aside className={cn(
          "absolute lg:relative z-20 w-72 h-full bg-zinc-950 border-r border-zinc-800 flex flex-col transition-transform duration-300 ease-in-out",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:-translate-x-full lg:w-0"
        )}>
          <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar pb-32">
            {/* IDENTITY */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                  <User size={12} />
                  Personagem
                </h2>
                <button 
                  onClick={() => setEditingId(!editingId)}
                  className="text-[9px] uppercase font-bold text-amber-500 hover:text-amber-400"
                >
                  {editingId ? "Salvar" : "Editar"}
                </button>
              </div>

              {!editingId ? (
                <div className="flex flex-col items-center text-center space-y-2">
                  <div className="relative group">
                    <div className="w-20 h-20 rounded-full border-2 border-amber-900/30 bg-zinc-900 flex items-center justify-center text-3xl overflow-hidden">
                      {char.avatarUrl ? (
                        <img src={char.avatarUrl} className="w-full h-full object-cover" alt="Avatar" />
                      ) : (
                        arcEmoji(char.arch)
                      )}
                    </div>
                    <input 
                      type="file" 
                      className="hidden" 
                      id="avatar-upload" 
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const r = new FileReader();
                        r.onload = (ev) => {
                          updateChar(c => { c.avatarUrl = ev.target?.result as string; });
                          flash("Avatar atualizado");
                        };
                        r.readAsDataURL(f);
                      }}
                    />
                    <label 
                      htmlFor="avatar-upload"
                      className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 rounded-full cursor-pointer transition-opacity"
                    >
                      <Plus size={20} className="text-white" />
                    </label>
                  </div>
                  <div>
                    <h3 className="text-lg font-serif font-bold text-amber-100">{char.name || "Sem Nome"}</h3>
                    <p className="text-xs text-zinc-500 italic">{char.arch || "Sem Arquétipo"}</p>
                  </div>
                  {(char.motiv || char.weak) && (
                    <div className="w-full space-y-1 pt-2">
                      {char.motiv && <p className="text-[10px] text-zinc-400 text-left"><span className="text-amber-500/60 mr-1">💡</span> {char.motiv}</p>}
                      {char.weak && <p className="text-[10px] text-zinc-400 text-left"><span className="text-red-500/60 mr-1">⚡</span> {char.weak}</p>}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase tracking-widest text-zinc-600 font-bold">Nome</label>
                    <input 
                      value={char.name || ""} 
                      onChange={e => updateChar(c => { c.name = e.target.value; })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase tracking-widest text-zinc-600 font-bold">Arquétipo</label>
                    <input 
                      value={char.arch || ""} 
                      onChange={e => updateChar(c => { c.arch = e.target.value; })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase tracking-widest text-zinc-600 font-bold">Motivação</label>
                    <input 
                      value={char.motiv || ""} 
                      onChange={e => updateChar(c => { c.motiv = e.target.value; })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase tracking-widest text-zinc-600 font-bold">Fraqueza</label>
                    <input 
                      value={char.weak || ""} 
                      onChange={e => updateChar(c => { c.weak = e.target.value; })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-500/50"
                    />
                  </div>
                </div>
              )}
            </section>

            {/* VITALITY & DEFENSE */}
            <section className="space-y-3">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                <Heart size={12} />
                Vitalidade & Defesa
              </h2>
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-around">
                  <div className="flex flex-col items-center">
                    <div className="flex items-end gap-1">
                      <input 
                        type="number"
                        value={char.hp ?? 0}
                        onChange={e => updateChar(c => { c.hp = Number(e.target.value); })}
                        className="w-10 bg-transparent text-xl font-serif font-bold text-red-500 text-center outline-none"
                      />
                      <span className="text-zinc-600 text-lg font-serif mb-0.5">/</span>
                      <input 
                        type="number"
                        value={char.hpMax ?? 0}
                        onChange={e => updateChar(c => { c.hpMax = Number(e.target.value); })}
                        className="w-10 bg-transparent text-lg font-serif font-bold text-zinc-500 text-center outline-none"
                      />
                    </div>
                    <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest mt-1">HP</span>
                  </div>
                  
                  <div className="w-px h-8 bg-zinc-800" />

                  <div className="flex flex-col items-center">
                    <div className="relative">
                      <Shield size={32} className="text-amber-600/40" />
                      <input 
                        type="number"
                        value={char.ac ?? 0}
                        onChange={e => updateChar(c => { c.ac = Number(e.target.value); })}
                        className="absolute inset-0 w-full bg-transparent text-center text-base font-bold text-amber-100 outline-none"
                      />
                    </div>
                    <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest mt-1">CA</span>
                  </div>
                </div>
                
                <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${(char.hp / char.hpMax) * 100}%` }}
                    className={cn(
                      "h-full transition-colors duration-500",
                      (char.hp / char.hpMax) < 0.3 ? "bg-red-600" : "bg-red-500"
                    )}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button 
                    onClick={() => applyHP(-1)}
                    className="py-1 bg-red-950/20 hover:bg-red-950/40 border border-red-900/30 rounded text-[9px] font-bold text-red-500 transition-colors"
                  >
                    Dano
                  </button>
                  <input 
                    id="hpAmt" 
                    type="number" 
                    defaultValue={1} 
                    className="w-[33px] mx-auto bg-zinc-950 border border-zinc-800 rounded text-center text-xs font-mono text-zinc-400"
                  />
                  <button 
                    onClick={() => applyHP(1)}
                    className="py-1 bg-emerald-950/20 hover:bg-emerald-950/40 border border-emerald-900/30 rounded text-[9px] font-bold text-emerald-500 transition-colors"
                  >
                    Cura
                  </button>
                </div>
              </div>
            </section>

            {/* ATTRIBUTES */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                  <Zap size={12} />
                  Atributos
                </h2>
                <select 
                  value={sys} 
                  onChange={e => setSys(e.target.value as any)}
                  className="bg-transparent text-[9px] font-bold text-amber-600 outline-none cursor-pointer"
                >
                  <option value="generic">Genérico</option>
                  <option value="dnd5e">D&D 5e</option>
                  <option value="gurps">GURPS</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {ATTR_CFG[sys].map(k => {
                  const val = getAttrVal(k);
                  const bonusVal = computeAttrBonus(char.skills, k);
                  return (
                    <div key={k} className="bg-zinc-900/40 border border-zinc-800 rounded p-2 flex flex-col items-center gap-1 group relative">
                      <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest">{k}</span>
                      <input 
                        type="number"
                        value={val}
                        onChange={e => setAttrVal(k, Number(e.target.value))}
                        className="w-full bg-transparent text-center text-lg font-serif font-bold text-amber-200 outline-none"
                      />
                      {sys === "dnd5e" && (
                        <span className="text-[9px] font-mono text-zinc-500">{d5mod(val)}</span>
                      )}
                      {bonusVal > 0 && (
                        <span className="absolute -top-1 -right-1 bg-emerald-600 text-[8px] font-bold text-white px-1 rounded shadow-lg">
                          +{bonusVal}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* SKILLS */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                  <Star size={12} />
                  Habilidades
                </h2>
                <button 
                  onClick={() => updateChar(c => { c.skills.push({ name: "Nova Hab", attr: "", bonus: 2 }); })}
                  className="p-1 hover:bg-zinc-800 rounded text-amber-500"
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="space-y-2">
                {char.skills.map((sk, i) => (
                  <div key={i} className="bg-zinc-900/40 border border-zinc-800 rounded p-2 space-y-2 group">
                    <div className="flex items-center gap-2">
                      <input 
                        value={sk.name}
                        onChange={e => updateChar(c => { c.skills[i].name = e.target.value; })}
                        className="flex-1 bg-transparent text-xs font-medium text-zinc-200 outline-none"
                        placeholder="Nome..."
                      />
                      <button 
                        onClick={() => updateChar(c => { c.skills.splice(i, 1); })}
                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-600 hover:text-red-500 transition-all"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <select 
                        value={sk.attr}
                        onChange={e => updateChar(c => { c.skills[i].attr = e.target.value; })}
                        className="bg-zinc-950 border border-zinc-800 rounded text-[9px] px-1 py-0.5 text-zinc-400 outline-none"
                      >
                        <option value="">Atrib</option>
                        {ATTR_CFG[sys].map(k => <option key={k} value={k}>{k}</option>)}
                      </select>
                      <div className="flex items-center gap-1 ml-auto">
                        <span className="text-[9px] text-zinc-600 font-bold uppercase">Bônus</span>
                        <input 
                          type="number"
                          value={sk.bonus}
                          onChange={e => updateChar(c => { c.skills[i].bonus = Number(e.target.value); })}
                          className="w-8 bg-zinc-950 border border-zinc-800 rounded text-center text-[10px] font-mono text-emerald-500 py-0.5"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* NOTES */}
            <section className="space-y-3">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                <BookOpen size={12} />
                Notas & Inventário
              </h2>
              <textarea 
                value={char.notes || ""}
                onChange={e => updateChar(c => { c.notes = e.target.value; })}
                placeholder="Itens, segredos, anotações..."
                className="w-full h-32 bg-zinc-900/40 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-400 outline-none focus:border-amber-500/30 resize-none custom-scrollbar"
              />
            </section>
          </div>
        </aside>

        {/* --- MAIN CHAT --- */}
        <main className="flex-1 flex flex-col bg-zinc-950 relative overflow-hidden">
          {/* BACKGROUND TEXTURE */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/paper-fibers.png')]" />
          
          <div 
            ref={logRef}
            className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar relative z-10"
          >
            {log.map(m => renderMsg(m))}
            {loading && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3 text-xs text-amber-500/60 italic font-serif"
              >
                <div className="flex gap-1">
                  <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0 }}>•</motion.span>
                  <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }}>•</motion.span>
                  <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.4 }}>•</motion.span>
                </div>
                O Mestre está tecendo o destino...
              </motion.div>
            )}
          </div>

          {/* INPUT AREA */}
          <div className="p-4 bg-zinc-950 border-t border-zinc-800 relative z-20">
            <div className="max-w-4xl mx-auto space-y-4">
              {/* DICE TRAY */}
              <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
                <div className="flex items-center gap-2 pr-4 border-r border-zinc-800">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Qtd</span>
                  <input 
                    type="number"
                    value={diceCount}
                    onChange={e => setDiceCount(Number(e.target.value))}
                    min={1}
                    max={20}
                    className="w-10 bg-zinc-900 border border-zinc-800 rounded px-1 py-1.5 text-xs font-mono text-amber-500 outline-none text-center"
                  />
                </div>
                <div className="flex items-center gap-1.5 pr-4 border-r border-zinc-800">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 mr-1">Dados</span>
                  {[4, 6, 8, 10, 12, 20, 100].map(d => (
                    <button 
                      key={d}
                      onClick={() => roll(d)}
                      className="w-9 h-9 flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold text-amber-500 transition-all hover:scale-110 active:scale-95"
                    >
                      d{d === 100 ? "%" : d}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 pl-2">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Bônus</span>
                  <input 
                    type="number"
                    value={bonus}
                    onChange={e => setBonus(Number(e.target.value))}
                    className="w-12 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-amber-500 outline-none"
                  />
                </div>
              </div>

              {/* TEXT INPUT */}
              <div className="relative flex items-end gap-2">
                <textarea 
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="O que você faz, aventureiro?"
                  rows={1}
                  className="flex-1 bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 outline-none focus:border-amber-500/40 focus:bg-zinc-900 transition-all resize-none max-h-32 custom-scrollbar"
                />
                <button 
                  onClick={send}
                  disabled={loading || !input.trim()}
                  className="p-3 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-xl text-white transition-all shadow-lg shadow-amber-900/20 active:scale-95"
                >
                  <Send size={20} />
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* --- MODALS --- */}
      <AnimatePresence>
        {modal === "upload" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-serif font-bold text-amber-100 flex items-center gap-2">
                  <FileUp size={20} className="text-amber-500" />
                  Importar Aventura
                </h2>
                <button onClick={() => setModal(null)} className="text-zinc-500 hover:text-white"><X size={20} /></button>
              </div>
              <div className="space-y-4">
                {!pendingFile ? (
                  <>
                    <p className="text-xs text-zinc-400">Suba um arquivo para continuar sua jornada.</p>
                    <div className="grid grid-cols-1 gap-3">
                      {/* JSON RESTORE */}
                      <button 
                        onClick={() => document.getElementById("adv-json-upload")?.click()}
                        className="flex items-center gap-3 p-4 bg-zinc-950/50 border border-zinc-800 rounded-xl hover:border-amber-500/30 transition-all text-left"
                      >
                        <RotateCcw size={20} className="text-amber-500" />
                        <div>
                          <div className="text-xs font-bold text-zinc-200">Restaurar Estado (JSON)</div>
                          <div className="text-[10px] text-zinc-500">Restaura ficha, log e histórico completo.</div>
                        </div>
                        <input 
                          id="adv-json-upload"
                          type="file"
                          accept=".json"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) {
                              setPendingFile(f);
                              setPendingType("json");
                            }
                          }}
                        />
                      </button>

                      {/* TEXT/PDF CONTEXT */}
                      <button 
                        onClick={() => document.getElementById("adv-text-upload")?.click()}
                        className="flex items-center gap-3 p-4 bg-zinc-950/50 border border-zinc-800 rounded-xl hover:border-amber-500/30 transition-all text-left"
                      >
                        <FileText size={20} className="text-emerald-500" />
                        <div>
                          <div className="text-xs font-bold text-zinc-200">Importar Contexto (TXT/PDF/DOCX)</div>
                          <div className="text-[10px] text-zinc-500">O Mestre lerá o arquivo para continuar a história.</div>
                        </div>
                        <input 
                          id="adv-text-upload"
                          type="file"
                          accept=".txt,.pdf,.docx"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) {
                              setPendingFile(f);
                              setPendingType("context");
                            }
                          }}
                        />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-6">
                    <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded flex items-center justify-center",
                        pendingType === "json" ? "bg-amber-500/20 text-amber-500" : "bg-emerald-500/20 text-emerald-500"
                      )}>
                        {pendingType === "json" ? <RotateCcw size={20} /> : <FileText size={20} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-zinc-200 truncate">{pendingFile.name}</div>
                        <div className="text-[10px] text-zinc-500 uppercase tracking-widest">
                          {pendingType === "json" ? "Estado da Aventura" : "Contexto Narrativo"}
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-zinc-500 italic">
                      {pendingType === "json" 
                        ? "Confirmar a restauração completa desta aventura?" 
                        : "O Mestre analisará este arquivo para continuar a história."}
                    </p>

                    <div className="flex gap-3">
                      <button 
                        onClick={() => { setPendingFile(null); setPendingType(null); }}
                        className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors"
                      >
                        Cancelar
                      </button>
                      <button 
                        onClick={handleConfirmUpload}
                        disabled={loading}
                        className="flex-1 py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-lg text-xs font-bold uppercase tracking-widest text-white transition-colors shadow-lg shadow-amber-900/20"
                      >
                        {loading ? "Processando..." : "OK"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}

        {modal === "new" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-serif font-bold text-amber-100 flex items-center gap-2">
                  <Sword size={20} className="text-amber-500" />
                  Nova Jornada
                </h2>
                <button onClick={() => setModal(null)} className="text-zinc-500 hover:text-white"><X size={20} /></button>
              </div>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Título da Aventura</label>
                  <input 
                    autoFocus
                    value={newAdvName}
                    onChange={e => setNewAdvName(e.target.value)}
                    placeholder="Ex: O Mistério da Torre Negra..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-sm outline-none focus:border-amber-500/50"
                  />
                </div>
                <p className="text-xs text-zinc-500 italic">Sua aventura atual será preservada automaticamente.</p>
                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setModal(null)}
                    className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={confirmNew}
                    className="flex-1 py-3 bg-amber-600 hover:bg-amber-500 rounded-lg text-xs font-bold uppercase tracking-widest text-white transition-colors shadow-lg shadow-amber-900/20"
                  >
                    Começar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {modal === "load" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-serif font-bold text-amber-100 flex items-center gap-2">
                  <RotateCcw size={20} className="text-amber-500" />
                  Carregar Jornada
                </h2>
                <button onClick={() => setModal(null)} className="text-zinc-500 hover:text-white"><X size={20} /></button>
              </div>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar relative">
                {advList.length === 0 ? (
                  <div className="text-center py-12 text-zinc-600 italic text-sm">Nenhuma aventura encontrada no pergaminho.</div>
                ) : (
                  advList.map(adv => (
                    <div 
                      key={adv.id}
                      onClick={() => selectAdv(adv.id)}
                      className={cn(
                        "group flex items-center gap-4 p-4 rounded-xl border transition-all cursor-pointer relative overflow-hidden",
                        adv.id === currentId ? "bg-amber-600/10 border-amber-600/40" : "bg-zinc-950/50 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-950"
                      )}
                    >
                      <div className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center text-xl">
                        {arcEmoji(adv.char?.arch)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-amber-100 truncate">{adv.name}</h3>
                        <p className="text-[10px] text-zinc-500 truncate">
                          {adv.char?.name || "Sem Nome"} • {adv.sys === "dnd5e" ? "D&D 5e" : "Genérico"} • {adv.updatedAt}
                        </p>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setDeletingId(adv.id); }}
                        className="p-2 text-zinc-700 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>

                      {/* DELETE CONFIRMATION OVERLAY */}
                      <AnimatePresence>
                        {deletingId === adv.id && (
                          <motion.div 
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="absolute inset-0 bg-zinc-900 flex items-center justify-center gap-4 z-10 px-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-[10px] font-bold uppercase text-red-500">Excluir?</span>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => setDeletingId(null)}
                                className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[9px] font-bold uppercase"
                              >
                                Não
                              </button>
                              <button 
                                onClick={() => deleteAdv(adv.id)}
                                className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-[9px] font-bold uppercase"
                              >
                                Sim
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- TOAST --- */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 right-6 z-[60] bg-zinc-900 border border-amber-500/40 px-4 py-2 rounded-lg shadow-2xl flex items-center gap-2"
          >
            <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-100">{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
