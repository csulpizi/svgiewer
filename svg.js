//
// TODA file view tool
//

// TODO:
// clean up scooching
// upload file (or pick an example?)
// later:
// highlight hitches
// hash check
// shape check
// sig check
// hitch check
// rig check
// make multi-successors a different size? (or a red ring?)
// list other shapes



const TWIST = 48
const BODY  = 49
const el = document.getElementById.bind(document)
const vp = el('viewport')

let showpipe = pipe( buff_to_env
                   , start_timer
                   , buff_to_rough
                   , untwist_bodies
                   , twist_list
                   , have_successors
                   , get_hitched
                   , get_in_line
                   , stack_lines
                   , scooch_twists
                   , place_twists
                   , end_timer
                   , render_svg
                   , select_focus
                   , write_stats
                   , probe
                   , setenv
                   )

function buff_to_env(buff) {
    env = {buff, atoms:[], dupes:[], index:{}, shapes:{}, errors:[], firsts:[]}
    return env
}

function start_timer(env) {
    env.time = {start: performance.now()}
    return env
}

function buff_to_rough(env) {
    let i = 0, b = env.buff, lb = b.byteLength

    while(i < lb) {
        // read values
        let afirst = i
        let hash = pluck_hash(b, i)
        if(!hash) {
            env.errors.push({afirst, message: "Improper atom"})
            return env                       // oh no buff is hopeless
        }
        i += hash.length/2
        let pfirst = i

        let shape = pluck_hex(b, i++, 1)

        let length = pluck_length(b, i)
        i += 4 + length

        // set values
        let atom = {shape, hash, bin: {length, afirst, pfirst, cfirst: pfirst+5, last: i-1}}
        if(env.index[hash]) {                // OPT: this takes 300ms w/ 10k atoms (1M dupes) -- but 500ms w/ Map
            env.dupes.push(atom)
            continue
        }
        env.atoms.push(atom)
        env.index[hash] = atom
        ;(env.shapes[shape]||=[]).push(atom) // shapes on demand
    }

    return env
}

function untwist_bodies(env) {
    env.shapes[BODY].forEach(a => {          // reverse twister all six body parts
        let i = a.bin.cfirst
        let p = pluck_hash(env.buff, i)      // order is important
        a.prev = env.index[p] || 0           // objectify prev
        let t = pluck_hash(env.buff, (i += leng(p)))
        a.teth = env.index[t] || 0           // objectify teth
        a.shld = pluck_hash(env.buff, (i += leng(t)))
        a.reqs = pluck_hash(env.buff, (i += leng(a.shld)))
        a.rigs = pluck_hash(env.buff, (i += leng(a.reqs)))
        a.carg = pluck_hash(env.buff, (i += leng(a.rigs)))
        a.hoisting = []                      // for consistency
        a.posts  = []
        a.rigtrie = pairtrier(a.rigs, env)   // trieify rigs
    })
    return env
}

function twist_list(env) {
    env.shapes[TWIST].forEach(a => {
        let b = pluck_hash(env.buff, a.bin.cfirst)
        a.body = env.index[b] || 0
        if(!a.body)                          // that's going to leave a mark
            return 0
        a.prev = a.body.prev                 // conveniences
        a.teth = a.body.teth
        a.posts = a.body.posts
        a.hoisting = a.body.hoisting
        a.succ = []
        a.leadhoists = []
        a.meethoists = []
        a.body.twist = a                     // HACK: could be multiples
    })
    return env
}

function have_successors(env) {
    env.shapes[TWIST].forEach(a => {         // seperate phase so everything will .succ
        if(!a.prev) return 0
        a.prev.succ.push(a)                  // HACK: doesn't check legitimacy
        if(a.prev.succ.length > 1)
            env.errors.push({twist: a, message: `Equivocation in "${a.prev.hash}"`})
    })
    return env
}

function get_hitched(env) {
    env.shapes[BODY].forEach(a => {          // slurps out connections. cheats a lot.
        if(!a.rigtrie) return 0
        a.rigtrie.pairs.forEach(pair => {
            let meet = env.index[pair[1]]    // HACK: doesn't check hoist
            if(!meet) return 0
            if(env.index[pair[0]])
                return a.posts.push(meet)    // HACK: doesn't check post
            let lead = fastprev(meet)
            if(!lead) return 0
            a.hoisting.push([lead, meet])
            lead.leadhoists.push(a.twist)    // in edges for up direction
            meet.meethoists.push(a.twist)
        })
    })
    return env
}

function get_in_line(env) {
    env.shapes[TWIST].forEach(a => {
        [a.first, a.findex] = get_first(a)
        if(!a.findex)
            env.firsts.push(a)               // a DAG root in this bag of atoms
    })
    return env
}

function get_first(a) {
    if (!a.prev)                             // creatio ex nihilo
        return [a, 0]
    else if (a.prev.first)                   // previously unknown as
        return [a.prev.first, a.prev.findex + 1]
    else                                     // get recursive on normies
        return (([a,b])=>[a,b+1])(get_first(a.prev))
}

function stack_lines(env) {                  // one-pass line aligner, B- for spools
    env.firsts.forEach((t,i) => t.y = i+1.5) // .5 for the atrocious ordering hack
    env.firsts.forEach((t,i) => {
        let min_tether = env.shapes[TWIST].filter(a=>a.first === t)
                            .reduce((acc, a) => Math.min(acc, a.teth?.first?.y||Infinity), Infinity)
        if(min_tether < t.y)                 // move lines under their lowest tether
            t.y = +((min_tether + "").slice(0,-1) + "0" + (i+1))
    })
    env.firsts.sort((a,b) => a.y - b.y).forEach((t,i) => t.y = i)
    return env
}

let mind = 20 // pronounced min-dee
function scooch_twists2(env) {
    walk_succ(env.firsts.at(-1), (t)=>t.x = t.findex*20) // set xs for first line first
    for(let i=env.firsts.length-2; i>=0; i--) {
        walk_succ(env.firsts[i], t => {
            let tethx = t.teth?.x || 0
            let postx = t.posts.reduce((acc, x) => Math.max(acc, x.x), 0)
            let leadx = t.leadhoists.reduce((acc, x) => Math.min(acc, x.x), Infinity)
            let meetx = t.meethoists.reduce((acc, x) => Math.min(acc, x.x), Infinity)
            // ?.x || 0 // ACK: this doesn't do anything, .post is never set (and is an array anyway, re mutlihitchs)
            t.minx = Math.max(tethx, postx)  // set minx&manx for each other line
            t.manx = Math.min(leadx, meetx)  // set minx&manx for each other line
            // t.manx = t.leadhoists[0]?.x || 0 // TODO: should be min not 0; also include meets ()

            // actually just try it with a decent minx and manx (including posts and meethoists and leadhoists array max) -- might be fine as is

            // let leadx = t.leadhoists[0]?.x || 0
            // let right = Math.max(tethx, postx)
            let minx = t.posts.concat(tethx).reduce((acc, x) => Math.max(acc, x.x), 0)
            let manx = t.leadhoists.concat(t.meethoists).reduce((acc, x) => Math.min(acc, x.x), Infinity)
            leadx = manx
            right = minx

            if(leadx && right)               // grating and flawed
                t.x = (leadx - right) / 2 + right
            else if(right)
                t.x = right + 10
            else if(leadx)
                t.x = leadx - 10
            else
                t.x = t.findex * 20

            if(t.x < t.prev?.x)
                t.x = t.prev.x + 20          // FIXME: breaks the leadx invariant

        })
    // propagate upshove: if n twists are squeezed between < n twists, add spacing... to just the last one?
    // shove twists apart by checking distance between two twists (by findex) -- though this will get weird when switching relays...
    // then recursively shove things apart that are too close... check the "x units" to see if there's space to fit it in.
    // set xs for other lines
    }
    env.shapes[TWIST].forEach(t => {
        t.cx = 5 + t.x
        t.cy = 400 - t.first.y * 30
        t.colour = t.first.hash.slice(2, 8)
    })
    return env
}

function scooch_twists(env) { // walk up from the bottom
    env.firsts.forEach(f => {
        let lastfast = 0
        walk_succ(f, t => {
            if(!t.teth) return 0
            t.min = maxby(t.posts.concat(t.teth), (a, b) => a.findex < b.findex) || 0 // TODO: same line!
            t.max = maxby(t.leadhoists.concat(t.meethoists), (a, b) => a.findex > b.findex) || 0 // TODO: same line!
            if(lastfast && t.max) {
                let myspace  = space(lastfast, t)
                let youspace = space(lastfast.min, t.max)
                if(myspace >= youspace - 1)
                    t.max.scooch = t.max.scooch|0 + myspace - youspace + 2
            // walk back: null -> stop, minx & manx & totesx (findex + scooch)
            // TODO: minx & manx should be per line, not general: tweak this to deal w/ multiline situations
            // TODO: offset rows by a half space
            // keep a rolling tally of minx -> manx
            // t3.minx === t4.minx, t3.manx === t4.manx => if space(t4.minx, t4.manx)<t3.minxdist then t4.scooch++
            // space(t.min, t.max) < space(tback, t) -- tback is prev max tmin, and nothing happens if there's no local tmax -- just roll it forward...
            // a is prev fast, b is current.
            // a has already fixed itself wrt its fast pred... but what does that mean? is a at the beginning of its possible span, or the end?
            // does it hurt to assume a is shoved against the right boundary?
            // we're not really placing anything, we're just spacing.
            // so ensure space(a.min, b.max) > space(a, b), or shove b.max over
            }
            lastfast = t
        })
    })
    return env
}

function place_twists(env) {
    for(let i=env.firsts.length-1; i>=0; i--) { // other end
        let x = 0 // i % 2 * (mind/2)
        walk_succ(env.firsts[i], t => {
            x += mind + (t.scooch|0) * mind
            x = x < t.min?.x ? t.min.x + (mind/2) : x
            t.x = x
            t.cx = t.x // TODO: eliminate
            t.cy = 400 - t.first.y * 30 // TODO: eliminate
            t.colour = t.first.hash.slice(2, 8)
        })
    }
    return env
}

function walk_succ(t, f) {              // presumably f is effectful
    while(t) {
        f(t)
        t = t.succ[0]
    }
}

function maxby(xs, f) {                 // pick the winning wrt x
    let acc = xs[0]
    xs.forEach(x => acc = f(acc, x) ? x : acc)
    return acc
}

function space(a, b) {
    let t = b, s = 0
    while(t && t != a) { // TODO: can maybe cache instead of walking?
        s += t.scooch|0 + 1
        t = t.prev
    }
    return s
}


function end_timer(env) {
    env.time.end = performance.now()
    return env
}

function render_svg(env) {
    let svgs = '', edgestr = '', edges = []
    env.shapes[TWIST].forEach(a => {
        if(!a.cx) return 0                   // ignore equivocal successors
        svgs += `<circle cx="${a.cx}" cy="${a.cy}" r="5" fill="#${a.colour}" id="${a.hash}" />`
        if(a.prev)
            edges.push([a, a.prev, 'prev'])
        if(a.teth)
            edges.push([a, a.teth, 'teth'])
        if(a.body.posts.length)
            a.body.posts.forEach(e => edges.push([a, e, 'post']))
        if(a.body.hoisting.length)
            a.body.hoisting.forEach(e => {
                edges.push([a, e[0], 'lead'])
                edges.push([a, e[1], 'meet'])
            })
    })
    edges.reverse().forEach(e => {           // prev and teth at back for style
        let fx = e[0].cx, fy = e[0].cy, tx = e[1].cx, ty = e[1].cy
        if(!(fx && fy && tx && ty)) return 0 // also eq successor
        edgestr += `<path d="M ${fx} ${fy} ${tx} ${ty}" fill="none" class="${e[2]}"/>`
    })
    vp.innerHTML = '<g id="gtag">' + edgestr + svgs + '</g>'
    return env
}

function select_focus(env) {
    env.focus = env.shapes[TWIST][env.shapes[TWIST].length-1]
    el(env.focus.hash).classList.add('focus')
    select_node(env.focus.hash)
    highlight_node(env.focus.hash)
    return env
}

function write_stats(env) {
    el('stats').innerHTML =
    `<p>Analyzed ${env.buff.byteLength.toLocaleString()} bytes
        containing ${env.atoms.length.toLocaleString()} atoms
        with ${env.dupes.length.toLocaleString()} duplicates
        in ${(env.time.end-env.time.start).toFixed(0)}ms.</p>
     <p>There are ${env.shapes[TWIST].length.toLocaleString()} twists,
        ${env.shapes[BODY].length.toLocaleString()} bodies,
        and <a href="#" onclick="showhide('errors')">${env.errors.length.toLocaleString()} errors</a>.
    </p>
    <p><a href="#" onclick="emojex()">emoji/hex</a> <a href="#" onclick="rainbowsparkles()">rainbow/sparkles</a></p>
    <div id="errors" class="hidden"><p>${hash_munge(env.errors.map(e=>e.message).join('</p><p>'))}</p></div>
    `
    return env
}

function probe(env) {
    console.log(env)
    return env
}

function setenv(x) {
    env = x                                  // make a global for DOM consumption
    return env                               // ^ kind of a hack but pipe is async
}

// DOM things

vp.addEventListener('wheel', e => {
    let dy = (201+Math.max(-200, Math.min(200, e.deltaY)))/200
    if((dy < 1 && vp.currentScale < 0.002) || (dy > 1 && vp.currentScale > 200)) return false
    vp.currentScale *= dy
    vp.currentTranslate.y = vp.currentTranslate.y * dy + vp.clientWidth * (1 - dy)
    vp.currentTranslate.x = vp.currentTranslate.x * dy + vp.clientHeight * (1 - dy)
    return e.preventDefault() || false
})

let panning=false
vp.addEventListener('mousedown', e => panning = true)
vp.addEventListener('mouseup', e => panning = false)
vp.addEventListener('click', e => {
    if(e.target.tagName === 'circle') {
        select_node(e.target.id)
    }
})
vp.addEventListener('mousemove', e => {
    if (e.target.tagName === 'circle') {
        highlight_node(e.target.id)
    }
    if(panning) {
        vp.currentTranslate.x += e.movementX * 3
        vp.currentTranslate.y += e.movementY * 3
    }
})

el('todafile').onchange = function (t) {
    let file = t.srcElement.files?.[0]
    showpipe(file.arrayBuffer())
}

el('todaurl').onchange = function (e) {
    let url = e.target.value.trim()
    window.location.hash = url
    fetch_url(url)
}

function fetch_url(url) {
    return fetch(url)
        .then(res => showpipe(res.arrayBuffer()))
        .catch(err => console.log('e', err)) // stop trying to make fetch happen
}

window.addEventListener('keydown', e => {
    if(typeof env === 'undefined') return true
    let key = e.keyCode, id = document.getElementsByClassName('select')[0]?.id
    let t = env.index[id]                    // global env
    if (!id || !t) return 0
    if (key === 38)                          // up up
        select_node(t.meethoists[0]?.hash || t.leadhoists[0]?.hash || t.posts[0]?.hash || t.teth?.hash)
    if (key === 40)                          // down down
        select_node(t.hoisting[0]?.[0]?.hash)
    if (key === 37)                          // left right
        select_node(t.prev.hash)
    if (key === 39)                          // left right
        select_node(t.succ[0]?.hash)
})

function select_node(id) {
    let t = env.index[id], dom = el(id)      // global env
    if (!t || !dom) return 0
        ;[...document.querySelectorAll('.select')].map(n => n.classList.remove('select'))
    dom.classList.add('select')
    let html = `<pre>${JSON.stringify(t, (k, v) => k ? (v.hash ? v.hash : v) : v, 2)}</pre>`
    el('select').innerHTML = hash_munge(html)
    scroll_to(t.cx, t.cy)
}

function highlight_node(id) {
    ;[...document.querySelectorAll('.highlight')].map(n => n.classList.remove('highlight'))
    el(id)?.classList?.add('highlight')
    let html  = `<p>Focus: ${hash_munge('"'+env.focus.hash+'"')}</p>`
        html += `<p>Highlight: "${id}"</p>`  // focus is here so it refreshes w/ emojihex
    el('highlight').innerHTML = hash_munge(html).replace(/onmouseover=".*?"/, '') // does not play well with onclick
}

function hash_munge(str) {                   // beautiful nonsense
    return str.replaceAll(/"(41.*?)"/g, '"<a href="" onmouseover="highlight_node(\'$1\')" onclick="select_node(\'$1\');return false;">$1</a>"').replaceAll(/>41(.*?)</g, (m,p) => emhx ? `>41${p}<` : `>${p.match(/.{1,11}/g).map(n=>emojis[parseInt(n,16)%emojis.length]).join('')}<`)
}

function scroll_to(x, y) {
    let MAGIC_CONSTANT = -2                  // ¯\_(ツ)_/¯
    // let MAGIC_CONSTANT = -2.2             // mysteriously, this value is needed when served from localhost
    vp.currentTranslate.x = MAGIC_CONSTANT * x * vp.currentScale + vp.clientWidth
    vp.currentTranslate.y = MAGIC_CONSTANT * y * vp.currentScale + vp.clientHeight
}

function showhide(id) {
    el(id)?.classList?.toggle('hidden')
}

function emojex() {
    emhx ^= 1
    select_node(document.getElementsByClassName('select')[0]?.id)
    highlight_node(document.getElementsByClassName('highlight')[0]?.id)
}

// helpers

let hexes = hexes_helper()
function hexes_helper() {
    return Array.from(Array(256)).map((n,i)=>i.toString(16).padStart(2, '0'))
}

function pluck_hex(b, s, l) {                // requires hexes helper
    let hex = ''
    let uints = new Uint8Array(b, s, l)      // OPT: 72ms
    for(i=0; i<l; i++)                       // OPT: 53ms
        hex += hexes[uints[i]]               // OPT: 144ms
    return hex
}

function pluck_hash(b, s) {
    let l = 0, ha = pluck_hex(b, s, 1)
    if(ha === '41')
        l = 32
    else
        return 0
    return ha + pluck_hex(b, s + 1, l)
}

function pluck_length(b, s) {
    let v = new DataView(b, s, 4)            // 32 bit bigendian int
    return v.getUint32()
}

function leng(h) {
    return h ? h.length/2 : 1                // byte length from hex or 0
}

function pairtrier(h, env) {
    let trie = env.index[h]
    if(!trie) return 0
    if(trie.shape !== '63') return 0         // don't try to trie a non-trie tree
    trie.pairs = []
    for(let i = trie.bin.cfirst; i < trie.bin.last;) {
        let k = pluck_hash(env.buff, i)
        i += leng(k)
        let v = pluck_hash(env.buff, i)
        i += leng(v)
        trie.pairs.push([k, v])
    }
    return trie
}

function fastprev(twist) {
    if(!twist.prev) return 0
    if(twist.prev.teth)
        return twist.prev
    return fastprev(twist.prev)
}

function rainbowsparkles() {
    ;[...document.querySelectorAll('path')].map(p=>p.classList.toggle('rainbowsparkles'))
    ;[...document.querySelectorAll('circle')].map(p=>p.classList.toggle('nodesparkles'))
}

emojis = get_me_all_the_emoji()
emhx = 1
function get_me_all_the_emoji() {            // over-the-top emoji fetching courtesy of bogomoji
    let testCanvas = document.createElement("canvas")
    let miniCtx = testCanvas.getContext('2d', {willReadFrequently: true})
    let q = []
    let MAGICK_EMOJI_NUMBER = 127514
    for (let i = 0; i < 2000; i++) {
        let char = String.fromCodePoint(MAGICK_EMOJI_NUMBER + i)
        if (is_char_emoji(miniCtx, char))
            q.push(char)
    }
    return q
}
function is_char_emoji(ctx, char) {
    let size = ctx.measureText(char).width
    if (!size) return false
    ctx.clearRect(0, 0, size + 3, size + 3)  // three is a lucky number
    ctx.fillText(char, 0, size)              // probably chops off the emoji edges
    let data = ctx.getImageData(0, 0, size, size).data
    for (var i = data.length - 4; i >= 0; i -= 4)
        if (!is_colour_boring(data[i], data[i + 1], data[i + 2]))
            return true
    return false
}
function is_colour_boring(r, g, b) {         // if the pixel is not black, white, or red,
    let s = r + g + b                        // then it probably belongs to an emoji
    return (!s || s === 765 || s === 255 && s === r)
}


function wrap(inn, f, out) {
    return env => {
        let val = f(env[inn])                // TODO: cope without inn&out
        let w = v => (env[out] = v) && env
        return val.constructor === Promise
             ? val.then(w)                   // fun made a promise
             : w(val)                        // TODO: promise back y'all
    }
}

function pipe(...funs) {
  function magic_pipe(env={}) {
    let fun, pc=0

    function inner() {
      fun = funs[pc++]
      if(!fun) return 0                      // no fun

      if(fun.async)                          // async fun (non-promise)
        return new Promise(f => fun.async(env, f)).then(cb)

      return cb(fun(env))                    // sync fun
    }

    function cb(new_env) {
      env = new_env                          // does something

      if(env && env.constructor === Promise)
        return env.then(cb)                  // promise fun

      return inner()
    }

    return cb(env)
  }

  return magic_pipe
}

// init
let url = window.location.hash.slice(1)
if(url) {
    el('todaurl').value = url
    fetch_url(url)
}