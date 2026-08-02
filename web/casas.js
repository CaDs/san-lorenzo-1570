// Donde se asienta una casa. Sin THREE, sin fetch y sin DOM: entra una huella y
// una funcion que dice la cota del terreno, y sale de donde arranca el muro,
// desde que cota mide el sombreador, cuantas plantas caben y donde acaba.
//
// Esto vivia dentro del forEach de buildingNodes(), mezclado con la semilla de
// material y con la construccion de la malla, y por eso no habia forma de
// comprobarlo sin montar el mundo entero en un navegador. En un dia salieron
// cuatro fallos seguidos de estas veinte lineas -franja ciega al pie de 858
// fachadas, 116 casas medio enterradas- y los cuatro eran MEDIBLES: se midieron
// a mano despues de verlos en una captura, que es justo el bucle que hay que
// romper.
//
// Es el mismo reparto que el proyecto ya hace dos veces: clima.js frente a
// daynight.js y ambiente.js frente a sonido.js. Los dos tienen su test de node y
// por eso no se rompen.

// Escala medieval, la misma que usaba world.js. OSM describe el pueblo de hoy:
// bloques de 4 a 6 plantas de 3 m. Un caserio medieval son 1 a 3 alturas escasas.
export const STOREY_H = 2.6;
export const MAX_STOREYS = 3;
export const STOREY_DIV = 3.2;

// La cota mas baja y la mas alta del terreno bajo una huella.
//
// Se muestrea tambien A LO LARGO de las aristas y no solo en los vertices. Una
// casa larga puede tener las cuatro esquinas a la misma cota y un lomo o una
// vaguada en medio, y con solo los vertices ese desnivel no existe: es
// exactamente el caso en el que el muro acaba por debajo del terreno sin que
// ninguna medida lo vea.
export function cotasDeHuella(flat, heightAt, porArista = 4) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    const j = (i + 2) % flat.length;
    for (let k = 0; k <= porArista; k++) {
      const t = k / porArista;
      const y = heightAt(flat[i] + (flat[j] - flat[i]) * t,
        flat[i + 1] + (flat[j + 1] - flat[i + 1]) * t);
      if (y < min) min = y;
      if (y > max) max = y;
    }
  }
  return { min, max };
}

// El asiento de una casa.
//
//   base   de donde arranca el muro. Va por debajo del terreno mas bajo, o la
//          casa flota por el lado de abajo.
//   suelo  desde donde se cuentan las plantas. Va del terreno mas ALTO: asi el
//          muro sobresale por todos lados y lo que sobra queda enterrado cuesta
//          abajo, que es lo que hace una casa en cuesta de verdad. Con el mas
//          bajo -que se probo- pasa lo contrario y la casa se entierra cuesta
//          arriba: 116 casas y la peor 16,7 m.
//   top    donde acaba el muro y arranca el tejado.
//
// Lo que NO sale de aqui es la cota desde la que mide el sombreador. Esa va por
// VERTICE, sacada del terreno bajo cada esquina del muro, porque ninguna cota
// unica sirve para las cuatro esquinas de una casa en cuesta: por un lado
// entierra el zocalo y por el otro lo deja flotando, y donde flota el sombreador
// apaga tambien los huecos y sale una franja ciega de varios metros.
export function asiento(flat, heightAt, b) {
  const { min, max } = cotasDeHuella(flat, heightAt);
  const plantas = Math.min(Math.max(Math.round(b.h / STOREY_DIV), 1), MAX_STOREYS);
  // El `base` de OSM puede quedar por encima del terreno en una ladera fuerte.
  // Se baja hasta donde haga falta: un muro que no llega al suelo se ve desde la
  // calle, y medio metro de mas enterrado no lo ve nadie.
  const base = Math.min(b.b, min - 0.2);
  return {
    base,
    suelo: max,
    top: max + plantas * STOREY_H,
    plantas,
    sueloMin: min,
    sueloMax: max,
  };
}

// El muestreo bilineal del heightmap, calcado del de world.js pero sin clase:
// lo necesitan igual el juego y el test, y tenerlo dos veces es tenerlo mal una
// de las dos. Ojo con la diagonal: el quad se parte de (i+1,j) a (i,j+1), o sea
// tx + tz = 1, y usar la otra diagonal desplaza la cota hasta medio metro en
// cuesta fuerte.
export function muestreador(heights, demW, demH, resM) {
  return (x, z) => {
    const fx = Math.min(Math.max(x / resM - 0.5, 0), demW - 1.001);
    const fz = Math.min(Math.max(z / resM - 0.5, 0), demH - 1.001);
    const i = fx | 0, j = fz | 0;
    const tx = fx - i, tz = fz - j;
    const h00 = heights[j * demW + i];
    const h10 = heights[j * demW + i + 1];
    const h01 = heights[(j + 1) * demW + i];
    const h11 = heights[(j + 1) * demW + i + 1];
    if (tx + tz <= 1) return h00 + tx * (h10 - h00) + tz * (h01 - h00);
    return h11 + (1 - tx) * (h01 - h11) + (1 - tz) * (h10 - h11);
  };
}
