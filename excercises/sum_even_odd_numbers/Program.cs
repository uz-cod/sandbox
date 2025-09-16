

//compito: calcolo della somma dei numeri pari da 1 a 100

var sum3 = Enumerable.Range(1, 100).Where(i => (i & 1) == 0).Sum();

var sum4 = Enumerable.Range(1, 100).Where(i => i % 2 == 0).Sum();

//più sintetica ed efficiente
var sum5 = Enumerable.Range(1, 50).Select(x => x * 2).Sum();

//top del top
//la somma dei primi n numeri pari è n(n+1)
var sum6 = 50*(50 + 1);

Console.WriteLine($"Somma dei numeri pari da 1 a 100: {sum6}");