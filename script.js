async function checkPrice() {
  const query = document.getElementById('productInput').value;
  const resultsDiv = document.getElementById('results');
  
  if (!query) {
    resultsDiv.innerHTML = "<p style='color:red;'>Please enter a product name or URL.</p>";
    return;
  }

  resultsDiv.innerHTML = "🔍 Checking prices...";

  try {
    // Replace with your backend API URL later
    const response = await fetch(`https://serpapi.com/api/price-check?query=${encodeURIComponent(query)}`);
    const data = await response.json();

    if (data.length === 0) {
      resultsDiv.innerHTML = "<p>No results found.</p>";
      return;
    }

    let html = "<h3>Lowest Prices:</h3><ul>";
    data.forEach(item => {
      html += `<li><a href="${item.link}" target="_blank">${item.title}</a> - ₹${item.price}</li>`;
    });
    html += "</ul>";

    resultsDiv.innerHTML = html;
  } catch (error) {
    resultsDiv.innerHTML = "<p style='color:red;'>Error fetching prices. Please try again later.</p>";
    console.error(error);
  }
}
