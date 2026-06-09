import os
import re
import subprocess
import sys
from typing import TypedDict
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

# ==========================================
# 1. Setup
# ==========================================
llm = ChatOpenAI(
    model="nemotron3:33b", 
    base_url="http://localhost:11434/v1",
    api_key="ollama"
)

# 假設你原本的網站檔案叫做 existing_site.html
TARGET_FILE = "03_frontend_index.html" 
OUTPUT_DIR = os.getcwd()

class AppState(TypedDict):
    existing_code: str       # 讀取到的舊程式碼
    modification_plan: str   # 修改計畫
    updated_code: str        # 修改後的程式碼
    feedback: str
    iteration_count: int
    is_integrated: bool      # 是否成功串接後端

# ==========================================
# 2. Nodes (The Modifier Team)
# ==========================================

def analyzer_node(state: AppState) -> AppState:
    print(f"\n🔍 [Analyzer] Reading and analyzing {TARGET_FILE}...")
    try:
        with open(os.path.join(OUTPUT_DIR, TARGET_FILE), "r", encoding="utf-8") as f:
            code = f.read()
    except FileNotFoundError:
        code = ""
    
    prompt = f"""
    You are a Senior Web Architect. 
    Analyze this existing HTML code:
    {code}
    
    Task: Create a "Modification Plan" (繁體中文) to:
    1. Inject React state to fetch data from our FastAPI backend (http://localhost:8000).
    2. Add "Visual Weight" logic to the existing UI elements.
    3. Ensure the layout remains intact but becomes dynamic.
    """
    plan = llm.invoke([HumanMessage(content=prompt)]).content
    return {"existing_code": code, "modification_plan": plan}

def modifier_node(state: AppState) -> AppState:
    print(f"\n🛠️ [Engineer] Injecting Sync-Us logic into existing site (Iteration {state['iteration_count'] + 1})...")
    
    prompt = f"""
    You are an Expert Web Developer specializing in UI Injection.
    Existing Code: {state['existing_code']}
    Modification Plan: {state['modification_plan']}
    
    Task: Rewrite the code to INTEGRATE with our backend.
    REQUIREMENTS:
    1. Maintain the existing style but add dynamic 'scaling' for task components.
    2. Ensure the 'fetch' calls point to 'http://localhost:8000/api/v1/...'.
    3. Use Traditional Chinese for new UI elements.
    4. Return the FULL updated HTML code.
    
    OUTPUT FORMAT: Wrap HTML in ```html ... ```
    """
    response = llm.invoke([HumanMessage(content=prompt)]).content
    return {"updated_code": response, "iteration_count": state["iteration_count"] + 1}

def verifier_node(state: AppState) -> AppState:
    print("\n🕵️‍♂️ [QA] Verifying Integration and UI Weights...")
    # 簡單邏輯檢查：是否包含 fetch 與 localhost:8000
    is_ok = "localhost:8000" in state["updated_code"] and "style" in state["updated_code"]
    return {"is_integrated": is_ok, "feedback": "" if is_ok else "Missing backend connection string!"}

# ==========================================
# 3. Graph Assembly
# ==========================================
workflow = StateGraph(AppState)
workflow.add_node("Analyzer", analyzer_node)
workflow.add_node("Modifier", modifier_node)
workflow.add_node("Verifier", verifier_node)

workflow.set_entry_point("Analyzer")
workflow.add_edge("Analyzer", "Modifier")
workflow.add_edge("Modifier", "Verifier")
workflow.add_conditional_edges("Verifier", lambda x: "end" if x["is_integrated"] else "retry", {"end": END, "retry": "Modifier"})

app = workflow.compile()

# ==========================================
# 4. Execute
# ==========================================
if __name__ == "__main__":
    print(f"🚀 Starting Site Modification Agent...")
    
    final_state = app.invoke({"existing_code": "", "modification_plan": "", "updated_code": "", "feedback": "", "iteration_count": 0, "is_integrated": False})

    # 將修改後的成果覆蓋或另存新檔
    html_match = re.search(r'```html\n(.*?)```', final_state["updated_code"], re.DOTALL)
    if html_match:
        with open("03_frontend_upgraded.html", "w", encoding="utf-8") as f:
            f.write(html_match.group(1))
        print("\n✨ SUCCESS! Your site has been upgraded and saved as '03_frontend_upgraded.html'.")
        print("🔗 It is now connected to your FastAPI backend at http://localhost:8000.")