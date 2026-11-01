// The stylesheet of every page, live and static: the editor's reading
// typography without its chrome, in both colour schemes.
module.exports = `
:root{--ink:#37352f;--ink-2:#55534e;--muted:#787774;--paper:#fff;--card:#f7f6f3;--line:#e9e9e7;--accent:#2383e2;
--sans:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
--gray:#787774;--brown:#976d57;--orange:#cc782f;--yellow:#c29343;--green:#548164;--blue:#487ca5;--purple:#8a67ab;--pink:#b35488;--red:#c4554d;
--bg-gray:#f1f1ef;--bg-brown:#f3eeee;--bg-orange:#f8ecdf;--bg-yellow:#faf3dd;--bg-green:#eef3ed;--bg-blue:#e9f3f7;--bg-purple:#f6f3f8;--bg-pink:#f9f2f5;--bg-red:#faecec;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--ink:#e6e6e4;--ink-2:#c9c9c6;--muted:#9b9b9b;--paper:#191919;--card:#252525;--line:#2f2f2f;--accent:#529cca;
--gray:#9b9b9b;--brown:#ba856f;--orange:#c77d48;--yellow:#ca9849;--green:#529e72;--blue:#5e87c9;--purple:#9d68d3;--pink:#d15796;--red:#df5452;
--bg-gray:#2f2f2f;--bg-brown:#4a3228;--bg-orange:#5c3b23;--bg-yellow:#564328;--bg-green:#243d30;--bg-blue:#143a4e;--bg-purple:#3c2d49;--bg-pink:#4e2c3c;--bg-red:#522e2a;color-scheme:dark}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 var(--sans)}
a{color:inherit}
.top{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;padding:.7rem 1.25rem;border-bottom:1px solid var(--line)}
.brand{font-weight:600;text-decoration:none}
.admin{margin-left:auto;font-size:.85rem;color:var(--muted)}
.admin a{color:var(--accent)}
.shell{display:grid;grid-template-columns:15rem minmax(0,1fr);max-width:72rem;margin:0 auto}
.side{padding:1.5rem 1rem;border-right:1px solid var(--line);font-size:.92rem}
.side ul{list-style:none;margin:0;padding:0}
.side ul ul{padding-left:.9rem}
.side a{display:block;padding:.2rem .5rem;border-radius:4px;text-decoration:none;color:var(--ink-2);overflow-wrap:anywhere}
.side a:hover{background:var(--card)}
.side a[aria-current=page]{background:var(--card);color:var(--ink);font-weight:600}
main{min-width:0;padding:2rem clamp(1rem,5vw,4rem) 4rem}
article{max-width:46rem}
.crumbs{font-size:.85rem;color:var(--muted);margin-bottom:1.5rem}
.crumbs a{text-decoration:none}
.crumbs a:hover{text-decoration:underline}
.cover{height:min(30vh,220px);min-height:120px;margin:-2rem calc(-1 * clamp(1rem,5vw,4rem)) 2rem;border-radius:0}
figure.file{margin:.8rem 0}
figure.file img{display:block}
figcaption{color:var(--muted);font-size:.85rem;margin-top:.3rem}
a.file{font-weight:500}
.title{font-size:2.4rem;line-height:1.2;margin:0 0 1.2rem;overflow-wrap:anywhere}
.pi{margin-right:.4rem}
article h2{font-size:1.75rem;margin:2rem 0 .5rem;line-height:1.3}
article h3{font-size:1.4rem;margin:1.6rem 0 .4rem;line-height:1.3}
article h4{font-size:1.15rem;margin:1.3rem 0 .3rem;line-height:1.3}
article p{margin:.35rem 0}
article ul,article ol{margin:.35rem 0;padding-left:1.6rem}
article ol ol{list-style:lower-alpha}
article ol ol ol{list-style:lower-roman}
article li{margin:.15rem 0}
ul.todo{list-style:none;padding-left:.2rem}
ul.todo ul.todo{padding-left:1.6rem}
.check{display:inline-block;width:1.4rem;color:var(--muted)}
li.done>.t{color:var(--muted);text-decoration:line-through}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.kids{margin-left:1.6rem}
blockquote{margin:.6rem 0;padding:.1rem 0 .1rem 1rem;border-left:3px solid currentColor}
.callout{display:flex;gap:.7rem;margin:.6rem 0;padding:1rem 1.1rem;border-radius:6px;background:var(--card)}
.ci{flex:none;font-size:1.2rem;line-height:1.5}
.ct{min-width:0}
pre{margin:.6rem 0;padding:1rem 1.2rem;border-radius:6px;background:var(--card);overflow:auto;font:.88rem/1.55 var(--mono)}
code{font-family:var(--mono);font-size:.88em;background:var(--card);padding:.1em .35em;border-radius:4px;color:var(--red)}
pre code{background:none;padding:0;color:inherit;font-size:inherit}
hr{border:0;border-top:1px solid var(--line);margin:1.2rem 0}
details{margin:.35rem 0}
summary{cursor:pointer}
.cols{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:1.5rem;margin:.6rem 0}
.pagelink{display:flex;gap:.4rem;padding:.25rem .3rem;margin:.1rem -.3rem;border-radius:4px;text-decoration:none;font-weight:500}
.pagelink .t{border-bottom:1px solid var(--line)}
.pagelink:hover{background:var(--card)}
.mention{text-decoration:none;border-bottom:1px solid var(--line);font-weight:500}
.mention .i{margin-right:.2rem}
article a:not(.mention):not(.pagelink){color:var(--accent)}
.val{font-variant-numeric:tabular-nums}
.toc{margin:.6rem 0;font-size:.95rem}
.toc a{display:block;padding:.1rem 0;color:var(--muted)!important;text-decoration:none}
.toc .l2{padding-left:1rem}.toc .l3{padding-left:2rem}
.table{overflow:auto;margin:.8rem 0}
table{border-collapse:collapse;font-size:.92rem}
th,td{border:1px solid var(--line);padding:.35rem .7rem;text-align:left;vertical-align:top}
th{background:var(--card);font-weight:600}
.stat{display:inline-block;margin:.5rem 1rem .5rem 0;padding:.8rem 1.1rem;border:1px solid var(--line);border-radius:8px}
.sv{font-size:1.8rem;font-weight:600;line-height:1.2}
.sl,.ql{color:var(--muted);font-size:.85rem}
.progress{margin:.6rem 0}
.progress progress{width:min(100%,24rem);vertical-align:middle}
.labelled{margin:.35rem 0}
.labelled .ql{margin-right:.5rem}
img{max-width:100%;border-radius:4px}
.sub{max-width:46rem;margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--line)}
.sub h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 .4rem}
.c-gray{color:var(--gray)}.c-brown{color:var(--brown)}.c-orange{color:var(--orange)}.c-yellow{color:var(--yellow)}.c-green{color:var(--green)}.c-blue{color:var(--blue)}.c-purple{color:var(--purple)}.c-pink{color:var(--pink)}.c-red{color:var(--red)}
.bg-gray{background:var(--bg-gray)}.bg-brown{background:var(--bg-brown)}.bg-orange{background:var(--bg-orange)}.bg-yellow{background:var(--bg-yellow)}.bg-green{background:var(--bg-green)}.bg-blue{background:var(--bg-blue)}.bg-purple{background:var(--bg-purple)}.bg-pink{background:var(--bg-pink)}.bg-red{background:var(--bg-red)}
p[class*=bg-],li[class*=bg-],h2[class*=bg-],h3[class*=bg-],h4[class*=bg-]{padding:.1rem .35rem;border-radius:4px}
footer{max-width:72rem;margin:0 auto;padding:1.5rem 1.25rem 3rem;color:var(--muted);font-size:.8rem;border-top:1px solid var(--line)}
.empty{color:var(--muted)}
.form{max-width:40rem}
.form fieldset{border:1px solid var(--line);border-radius:8px;padding:1rem 1.2rem;margin:0 0 1.5rem}
.form legend{font-weight:600;padding:0 .3rem}
.form label{display:block;margin:.6rem 0 .2rem;font-size:.9rem;color:var(--ink-2)}
.form input,.form select{width:100%;font:inherit;padding:.45rem .6rem;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)}
.form .hint{font-size:.82rem;color:var(--muted);margin:.25rem 0 0}
.form .row{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem}
.form button{font:inherit;font-weight:500;padding:.5rem 1rem;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.form button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.note{padding:.7rem 1rem;border-radius:6px;background:var(--bg-green);margin:0 0 1.5rem}
.note.bad{background:var(--bg-red)}
.facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.3rem 1rem;margin:0 0 1.5rem;font-size:.92rem}
.facts dt{color:var(--muted)}.facts dd{margin:0;overflow-wrap:anywhere}
@media (max-width:760px){.shell{grid-template-columns:minmax(0,1fr)}.side{border-right:0;border-bottom:1px solid var(--line);padding:1rem}.title{font-size:2rem}.cols{grid-auto-flow:row}}
`;
