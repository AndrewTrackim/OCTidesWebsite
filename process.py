f = open("tides.csv", 'r')
height = []
time = []
for x in f:
    parts = x.split(',')
    print(parts)
    print(parts[1][0:len(parts[1]) - 2])
    height.append(float(parts[1][0:len(parts[1]) - 2]))
    time.append(parts[0])

print(height)
print(time)

