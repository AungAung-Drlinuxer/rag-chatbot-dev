
import("puppeteer-core").then(async ({default:p})=>{
const b=await p.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:"new",args:["--no-sandbox","--disable-dev-shm-usage"]});
const pg=await b.newPage();
pg.on("pageerror",e=>console.log("PAGEERR:",e.message.slice(0,120)));
pg.on("console",m=>{if(m.type()==="error")console.log("CONSOLE:",m.text().slice(0,120));});
await pg.setViewport({width:1440,height:900});
await pg.goto("http://127.0.0.1:1420/",{waitUntil:"networkidle2",timeout:30000});
await pg.type("#login-username","dev");await pg.type("#login-password","dev");
await new Promise(r=>setTimeout(r,400));
await pg.evaluate(()=>{const b=[...document.querySelectorAll("button")].find(x=>/sign in/i.test(x.textContent));b&&b.click();});
await new Promise(r=>setTimeout(r,2500));
// go to Tickets
await pg.evaluate(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Tickets");b&&b.click();});
await new Promise(r=>setTimeout(r,2000));
const t1 = await pg.evaluate(()=>document.body.innerText.slice(0,600));
console.log("TICKETS PAGE TEXT:", JSON.stringify(t1.slice(0,400)));
await pg.screenshot({path:"C:/Users/aungaung/it-help-chatbot/docs/tickets-real.png"});
// Dashboard
await pg.evaluate(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Dashboard");b&&b.click();});
await new Promise(r=>setTimeout(r,2500));
const t2 = await pg.evaluate(()=>document.body.innerText);
console.log("HAS ITHD-1 on dashboard:", t2.includes("ITHD-1"));
await pg.screenshot({path:"C:/Users/aungaung/it-help-chatbot/docs/dashboard-real.png"});
await b.close();});
