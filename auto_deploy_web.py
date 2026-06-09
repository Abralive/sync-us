import os
import re
import subprocess
import sys
from typing import TypedDict
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

# ==========================================
# 1. Setup Nemotron-3 Engine
# ==========================================
llm = ChatOpenAI(
    model="nemotron3:33b", 
    base_url="http://localhost:11434/v1",
    api_key="ollama"
)

OUTPUT_DIR = os.getcwd()

class AppState(TypedDict):
    raw_requirements: str
    proposal: str
    code_output: str
    feedback: str
    qa_approved: bool
    pm_approved: bool
    iteration_count: int

# ==========================================
# 2. Nodes: Specialized for "Direct Serving"
# ==========================================

def planner_node(state: AppState) -> AppState:
    print("\n📝 [Planner] Designing a self-serving Web Architecture...")
    prompt = f"Target: A 'Sync-Us' web app. Backend must serve the frontend HTML at the root '/' path. Use Traditional Chinese."
    response = llm.invoke([HumanMessage(content=prompt)]).content
    return {"proposal": response}

def engineer_node(state: AppState) -> AppState:
    print(f"\n👨‍💻 [Engineer] Building the 'All-in-One' System (Iteration {state['iteration_count'] + 1})...")
    prompt = f"""
    Build the 'Sync-Us' app. 
    Requirement: 
    1. Backend (FastAPI): Must use 'FileResponse' to serve 'index.html' at route '/'.
    2. Frontend (React/HTML): Single HTML file with Tailwind CSS. Visual Weighting for tasks.
    3. Integration: Frontend must fetch from '/api/v1/tasks'.
    
    Format: 
    Wrap Python in ```python ... ```
    Wrap HTML in ```html ... ```
    """
    response = llm.invoke([HumanMessage(content=prompt)]).content
    return {"code_output": response, "iteration_count": state["iteration_count"] + 1, "feedback": ""}

def qa_tester_node(state: AppState) -> AppState:
    print("\n🕵️‍♂️ [QA] Checking for 'Root Route' integration...")
    # 檢查是否有寫回傳 index.html 的邏輯
    has_root = "FileResponse" in state["code_output"] and "index.html" in state["code_output"]
    return {"qa_approved": has_root, "feedback": "Missing root FileResponse" if not has_root else ""}

# ==========================================
# 3. Graph Assembly
# ==========================================
workflow = StateGraph(AppState)
workflow.add_node("Planner", planner_node)
workflow.add_node("Engineer", engineer_node)
workflow.add_node("QA", qa_tester_node)

workflow.set_entry_point("Planner")
workflow.add_edge("Planner", "Engineer")
workflow.add_edge("Engineer", "QA")
workflow.add_conditional_edges("QA", lambda x: "end" if x["qa_approved"] else "retry", {"end": END, "retry": "Engineer"})
app = workflow.compile()

# ==========================================
# 4. Final Execution & Deployment
# ==========================================
if __name__ == "__main__":
    print(f"🚀 Nemotron is building your project. Go grab a coffee...")
    
    final_state = app.invoke({"raw_requirements": "Sync-Us Web App", "proposal": "", "code_output": "", "feedback": "", "qa_approved": False, "pm_approved": False, "iteration_count": 0})

    code = final_state["code_output"]
    be_match = re.search(r'```python\n(.*?)```', code, re.DOTALL)
    fe_match = re.search(r'```html\n(.*?)```', code, re.DOTALL)

    if fe_match:
        with open("index.html", "w", encoding="utf-8") as f:
            f.write(fe_match.group(1))
    
    if be_match:
        with open("02_backend_main.py", "w", encoding="utf-8") as f:
            f.write(be_match.group(1))

    print("\n🛠️ Auto-fixing environment and clearing ports...")
    subprocess.run([sys.executable, "-m", "pip", "install", "fastapi", "uvicorn", "sqlalchemy", "aiosqlite"], stdout=subprocess.DEVNULL)
    # 強制清理 8000 Port
    subprocess.run("fuser -k 8000/tcp", shell=True, check=False)

    print("\n✅ SYSTEM ONLINE!")
    print("👉 Now open your browser and go to: http://localhost:8000")
    print("It will show your app DIRECTLY on the home page.")

    if be_match:
        subprocess.run(["uvicorn", "02_backend_main:app", "--host", "0.0.0.0", "--port", "8000"])